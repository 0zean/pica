import EngineClient
import Foundation
import PicaProtocol
import Synchronization

/// Starts `picad`, connects the `EngineClient` to it, and restarts it when it dies (A-01, `docs/app-shell.md`).
///
/// An engine already listening on the socket, such as one the CLI started (§4.1), is used as it is. When the
/// connection drops, the client reconnects by itself; the supervisor's part is to have an engine listening again.
public actor EngineSupervisor {
    public struct Configuration: Sendable {
        /// How long a started engine has to print its ready line.
        public var startTimeout: Duration = .seconds(10)
        /// Delay before each restart after the first, which is immediate. The last delay repeats.
        public var restartDelays: [Duration] = [.milliseconds(250), .milliseconds(500), .seconds(1), .seconds(2)]
        /// Starts in a row that end before the ready line, after which the supervisor reports `.failed` and waits for `retry()`.
        public var maxFailedStarts = 3
        /// H-05: an engine that exits within this long of its ready line has crashed early; early crashes in a row back off.
        public var crashWindow: Duration = .seconds(60)
        /// Delay before restarting after each early crash in a row. The first is immediate, so one crash recovers
        /// within A-01's 2 s budget. The last delay repeats.
        public var crashRestartDelays: [Duration] = [.zero, .seconds(1), .seconds(2), .seconds(4)]
        /// Early crashes in a row after which the supervisor reports `.failed` (`engine_crash_loop`) and waits for `retry()`.
        public var maxEarlyCrashes = 5

        public init() {}
    }

    /// The client the app talks to the engine through. It outlives engine restarts, so event streams resume (A-02).
    public nonisolated let client: EngineClient
    private let command: Result<EngineCommand, EngineFailure>
    private let socketPath: String
    private let logURL: URL
    private let appProtocol: ProtocolVersion
    private let configuration: Configuration
    private let clock: any Clock<Duration>

    /// The engine this supervisor started, if it is running. Readable outside the actor so quitting can stop it at once.
    private nonisolated let owned = Mutex<EngineProcess?>(nil)
    private var status = EngineStatus.starting
    private var statusListeners: [UUID: AsyncStream<EngineStatus>.Continuation] = [:]
    private var started = false
    private var launching = false
    /// Set by `stop()` and by a protocol mismatch: no more restarts.
    private var halted = false
    private var failedStarts = 0
    private var earlyCrashes = 0
    /// Whether the engine the client last connected to is one this supervisor started (and `watch` restarts).
    private var startedCurrentEngine = false
    /// Measures how long the running engine has been ready, on `clock`.
    private let stopwatch: @Sendable () -> @Sendable () -> Duration

    public init(
        command: Result<EngineCommand, EngineFailure>,
        socketPath: String,
        secrets: any SecretBroker,
        clientConfiguration: EngineClient.Configuration = EngineSupervisor.clientConfiguration(),
        configuration: Configuration = Configuration(),
        clock: any Clock<Duration> = ContinuousClock()
    ) {
        self.command = command
        self.socketPath = socketPath
        logURL = URL(filePath: socketPath).deletingLastPathComponent().appending(path: "picad.log")
        appProtocol = clientConfiguration.protocolVersion
        self.configuration = configuration
        self.clock = clock
        stopwatch = Self.stopwatch(on: clock)
        client = EngineClient(socketPath: socketPath, secrets: secrets, clock: clock, configuration: clientConfiguration)
    }

    /// The client retries a local socket every 250 ms at most, so a restarted engine is found within the 2 s recovery budget.
    public static func clientConfiguration() -> EngineClient.Configuration {
        var configuration = EngineClient.Configuration()
        configuration.reconnectDelays = [.milliseconds(50), .milliseconds(100), .milliseconds(250)]
        return configuration
    }

    /// The process id of the engine this supervisor started, or nil when it uses one it did not start.
    public nonisolated var engineProcessIdentifier: Int32? {
        owned.withLock { $0?.processIdentifier }
    }

    /// The current status, then every change.
    public func statuses() -> AsyncStream<EngineStatus> {
        let (stream, continuation) = AsyncStream<EngineStatus>.makeStream()
        let id = UUID()
        continuation.yield(status)
        statusListeners[id] = continuation
        continuation.onTermination = { _ in
            Task { await self.removeStatusListener(id) }
        }
        return stream
    }

    public func start() {
        guard !started else { return }
        started = true
        Task { await self.followClient() }
        Task { await self.boot() }
    }

    /// Starts the engine again after `.failed`.
    public func retry() {
        guard case .failed = status, !halted else { return }
        failedStarts = 0
        earlyCrashes = 0
        publish(.starting)
        Task { await self.launch() }
    }

    /// Stops the engine this supervisor started, waiting for it to exit, and closes the client.
    public func stop() async {
        halted = true
        await client.close()
        await stopOwnedEngine()
        for listener in statusListeners.values { listener.finish() }
        statusListeners = [:]
    }

    /// Sends SIGTERM to the engine this supervisor started. Safe to call from `applicationWillTerminate`.
    public nonisolated func terminateEngine() {
        owned.withLock { $0?.terminate() }
    }

    private func boot() async {
        do {
            try await client.connect()
            return
        } catch let error as EngineClientError {
            if let incompatible = EngineStatus.incompatibility(error, app: appProtocol) {
                await halt(incompatible)
                return
            }
        } catch {
            // No engine is listening; start one.
        }
        await launch()
    }

    private func followClient() async {
        for await state in await client.connectionStates() where !halted {
            switch state {
            case .connected(let hello):
                failedStarts = 0
                publish(.connected(hello))
            case .reconnecting:
                // The supervisor gave up on an engine that kept crashing (H-05); the client still retries.
                if case .failed = status { break }
                publish(.reconnecting)
                // An engine this supervisor did not start has gone away; start one. `watch` restarts one it started.
                if !startedCurrentEngine {
                    Task { await self.launch() }
                }
            case .refused(let error):
                await halt(EngineStatus.incompatibility(error, app: appProtocol) ?? .incompatible(app: appProtocol, engine: nil))
            case .idle, .closed:
                break
            }
        }
    }

    /// Starts engines until one prints its ready line, waiting `restartDelays` between failed starts.
    private func launch() async {
        guard !launching, !halted else { return }
        launching = true
        defer { launching = false }
        let command: EngineCommand
        switch self.command {
        case .failure(let failure):
            publish(.failed(failure))
            return
        case .success(let resolved):
            command = resolved
        }
        while !halted {
            switch await startOnce(command) {
            case .success:
                await connectIfIdle()
                return
            case .failure(let failure):
                failedStarts += 1
                if failedStarts >= configuration.maxFailedStarts {
                    publish(.failed(failure))
                    return
                }
                let delays = configuration.restartDelays
                let delay = delays.isEmpty ? .zero : delays[min(failedStarts - 1, delays.count - 1)]
                do {
                    try await clock.sleep(for: delay)
                } catch {
                    return
                }
            }
        }
    }

    private func startOnce(_ command: EngineCommand) async -> Result<Void, EngineFailure> {
        let engine: EngineProcess
        do {
            engine = try EngineProcess.start(command, socketPath: socketPath, logURL: logURL)
        } catch {
            return .failure(error)
        }
        owned.withLock { $0 = engine }
        startedCurrentEngine = true
        switch await engine.waitUntilReady(timeout: configuration.startTimeout, clock: clock) {
        case .ready:
            let uptime = stopwatch()
            Task { await self.watch(engine, uptime: uptime) }
            return .success(())
        case .exited(let termination):
            forget(engine)
            let reason = engine.lastLogMessage().map { ": \($0)" } ?? ""
            return .failure(EngineFailure(
                code: .engineStartFailed,
                message: "The engine \(termination.described) before it was ready\(reason). See \(logURL.path)."))
        case .timedOut:
            forget(engine)
            return .failure(EngineFailure(
                code: .engineStartTimeout,
                message: "The engine was not ready within \(configuration.startTimeout). See \(logURL.path)."))
        }
    }

    /// The client reconnects on its own once it has been connected; before that, the first connection is made here.
    private func connectIfIdle() async {
        guard await client.state == .idle else { return }
        do {
            try await client.connect()
        } catch {
            if let clientError = error as? EngineClientError,
               let incompatible = EngineStatus.incompatibility(clientError, app: appProtocol) {
                await halt(incompatible)
            } else {
                publish(.failed(EngineFailure(
                    code: .engineStartFailed, message: "The engine started but did not answer on \(socketPath): \(error).")))
            }
        }
    }

    private func watch(_ engine: EngineProcess, uptime: @Sendable () -> Duration) async {
        let termination = await engine.waitForExit()
        guard forget(engine), !halted else { return }
        earlyCrashes = uptime() < configuration.crashWindow ? earlyCrashes + 1 : 1
        if earlyCrashes >= configuration.maxEarlyCrashes {
            let last = termination.map { " The last time it \($0.described)." } ?? ""
            publish(.failed(EngineFailure(
                code: .engineCrashLoop,
                message: "The engine stopped \(earlyCrashes) times in a row, each within \(configuration.crashWindow) of "
                    + "starting, so Pica stopped restarting it.\(last) See \(logURL.path).")))
            return
        }
        do {
            try await clock.sleep(for: Self.crashRestartDelay(after: earlyCrashes, configuration))
        } catch {
            return
        }
        guard !halted else { return }
        await launch()
    }

    /// The delay before restarting after the `crashes`th early crash in a row.
    static func crashRestartDelay(after crashes: Int, _ configuration: Configuration) -> Duration {
        let delays = configuration.crashRestartDelays
        guard crashes > 0, !delays.isEmpty else { return .zero }
        return delays[min(crashes - 1, delays.count - 1)]
    }

    private static func stopwatch<C: Clock<Duration>>(on clock: C) -> @Sendable () -> @Sendable () -> Duration {
        {
            let start = clock.now
            return { start.duration(to: clock.now) }
        }
    }

    /// Clears `owned` if it still holds `engine`; returns whether it did.
    @discardableResult
    private func forget(_ engine: EngineProcess) -> Bool {
        owned.withLock { current in
            guard current === engine else { return false }
            current = nil
            return true
        }
    }

    /// Stops for good: an engine that refused the app is of no use, so the one this supervisor started is stopped.
    private func halt(_ blocking: EngineStatus) async {
        halted = true
        await stopOwnedEngine()
        publish(blocking)
    }

    private func stopOwnedEngine() async {
        guard let engine = owned.withLock({ $0 }) else { return }
        await engine.stop(grace: .seconds(3), clock: clock)
        forget(engine)
    }

    private func publish(_ newStatus: EngineStatus) {
        guard newStatus != status else { return }
        status = newStatus
        for listener in statusListeners.values { listener.yield(newStatus) }
    }

    private func removeStatusListener(_ id: UUID) {
        statusListeners[id] = nil
    }
}
