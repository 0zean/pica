import Foundation
import PicaProtocol

/// The app's only connection to `picad`: JSON-RPC 2.0 over NDJSON on a Unix socket (§4.1, §4.5).
///
/// Behavior on timeouts, cancellation, and reconnects is specified in `docs/engine-client.md`.
public actor EngineClient {
    public struct Configuration: Sendable {
        public var clientName = "Pica"
        public var clientVersion = "0.0.0"
        public var requestTimeout: Duration = .seconds(30)
        /// Delay before each reconnect attempt after the first, which is immediate. The last delay repeats.
        public var reconnectDelays: [Duration] = [.milliseconds(100), .milliseconds(250), .milliseconds(500), .seconds(1), .seconds(2)]
        /// Matches the engine's limit (E-05).
        public var maxFrameBytes = 8 * 1024 * 1024

        public init() {}
    }

    public enum ConnectionState: Equatable, Sendable {
        case idle
        case connected(EngineHelloResult)
        case reconnecting
        /// The engine refused the handshake, for example on a protocol major mismatch. The client stops reconnecting.
        case refused(EngineClientError)
        case closed
    }

    let socketPath: String
    let secrets: any SecretBroker
    let clock: any Clock<Duration>
    let configuration: Configuration
    let encoder = JSONEncoder()
    let decoder = JSONDecoder()

    var connection: UnixSocketConnection?
    /// Increases with each connection, so callbacks from an old connection can be told apart.
    var generation = 0
    var nextRequestId = 0
    var pending: [RequestId: PendingRequest] = [:]
    var subscriptions = EventSubscriptions()
    var notificationListeners: [String: [UUID: NotificationListener]] = [:]
    var stateListeners: [UUID: AsyncStream<ConnectionState>.Continuation] = [:]
    public private(set) var state = ConnectionState.idle
    var reconnectTask: Task<Void, Never>?

    public init(
        socketPath: String,
        secrets: any SecretBroker,
        clock: any Clock<Duration> = ContinuousClock(),
        configuration: Configuration = Configuration()
    ) {
        self.socketPath = socketPath
        self.secrets = secrets
        self.clock = clock
        self.configuration = configuration
    }

    /// Opens the socket and performs `engine.hello`. Makes one attempt; reconnecting starts only after a connection was established.
    @discardableResult
    public func connect() async throws -> EngineHelloResult {
        switch state {
        case .closed:
            throw EngineClientError.closed
        case .connected(let hello):
            return hello
        case .idle, .reconnecting, .refused:
            return try await establish()
        }
    }

    /// Closes the connection, fails pending requests with `.closed`, and finishes every stream.
    public func close() {
        guard state != .closed else { return }
        reconnectTask?.cancel()
        reconnectTask = nil
        connection?.close()
        connection = nil
        failPendingRequests(with: .closed)
        subscriptions.finishAll(throwing: nil)
        for listeners in notificationListeners.values {
            for listener in listeners.values { listener.finish() }
        }
        notificationListeners = [:]
        publish(.closed)
        for listener in stateListeners.values { listener.finish() }
        stateListeners = [:]
    }

    /// The current state, then every change.
    public func connectionStates() -> AsyncStream<ConnectionState> {
        let (stream, continuation) = AsyncStream<ConnectionState>.makeStream()
        let id = UUID()
        continuation.yield(state)
        if state == .closed {
            continuation.finish()
            return stream
        }
        stateListeners[id] = continuation
        continuation.onTermination = { _ in
            Task { await self.removeStateListener(id) }
        }
        return stream
    }

    private func removeStateListener(_ id: UUID) {
        stateListeners[id] = nil
    }

    func publish(_ newState: ConnectionState) {
        state = newState
        for listener in stateListeners.values { listener.yield(newState) }
    }

    private func establish() async throws -> EngineHelloResult {
        let opened: UnixSocketConnection
        do {
            opened = try UnixSocketConnection.connect(to: socketPath, maxFrameBytes: configuration.maxFrameBytes)
        } catch {
            throw EngineClientError.socket(error)
        }
        generation += 1
        connection = opened
        let current = generation
        Task { await self.read(opened, generation: current) }
        do {
            let hello = try await request(
                Methods.EngineHello.self,
                EngineHelloParams(
                    protocolVersion: .current,
                    client: .init(name: configuration.clientName, version: configuration.clientVersion)))
            try await resubscribeAll()
            publish(.connected(hello))
            return hello
        } catch {
            opened.close()
            throw error
        }
    }

    private func read(_ opened: UnixSocketConnection, generation readerGeneration: Int) async {
        do {
            for try await line in opened.lines {
                receive(line)
            }
        } catch {
            // A read error and a clean close are handled the same way.
        }
        connectionLost(generation: readerGeneration)
    }

    private func connectionLost(generation lostGeneration: Int) {
        guard lostGeneration == generation, connection != nil else { return }
        connection = nil
        failPendingRequests(with: .disconnected)
        subscriptions.connectionLost()
        if case .connected = state {
            startReconnecting()
        }
    }

    private func startReconnecting() {
        publish(.reconnecting)
        reconnectTask = Task { await self.reconnect() }
    }

    private func reconnect() async {
        var attempt = 0
        while state == .reconnecting && !Task.isCancelled {
            do {
                _ = try await establish()
                reconnectTask = nil
                return
            } catch let error as EngineClientError where error.code == .protocolVersionMismatch {
                reconnectTask = nil
                publish(.refused(error))
                subscriptions.finishAll(throwing: error)
                return
            } catch {
                // Try again after the next delay.
            }
            let delays = configuration.reconnectDelays
            let delay = delays.isEmpty ? .zero : delays[min(attempt, delays.count - 1)]
            attempt += 1
            do {
                try await clock.sleep(for: delay)
            } catch {
                return
            }
        }
    }

    private func receive(_ line: Data) {
        guard let header = try? decoder.decode(IncomingHeader.self, from: line) else { return }
        switch (header.id, header.method) {
        case (let id?, nil):
            resolve(id, with: line)
        case (let id?, let method?):
            answerEngineRequest(id: id, method: method, line: line)
        case (nil, let method?):
            deliverNotification(method: method, header: header, line: line)
        case (nil, nil):
            // An error response with a null id, such as frame_too_large; no request can be matched to it.
            return
        }
    }
}
