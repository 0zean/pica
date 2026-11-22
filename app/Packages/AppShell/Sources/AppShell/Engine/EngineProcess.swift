import Darwin
import Foundation
import Synchronization

/// One run of `picad` started by the app. Its stdout carries the ready line; its stderr is appended to `picad.log`.
final class EngineProcess: Sendable {
    enum Termination: Equatable, Sendable {
        case exited(Int32)
        case signaled(Int32)

        var described: String {
            switch self {
            case .exited(let code): "exited with code \(code)"
            case .signaled(let signal): "was stopped by signal \(signal)"
            }
        }
    }

    enum Readiness: Equatable, Sendable {
        case ready
        case exited(Termination)
        case timedOut
    }

    let processIdentifier: Int32
    let logURL: URL
    private let logOffset: UInt64
    private let stdout: FileHandle
    private let termination: OneShot<Termination>
    /// `Process` is not Sendable; it is kept only so its termination handler stays alive.
    private let process: Mutex<Process>

    private init(process: sending Process, stdout: FileHandle, termination: OneShot<Termination>, logURL: URL, logOffset: UInt64) {
        processIdentifier = process.processIdentifier
        self.process = Mutex(process)
        self.stdout = stdout
        self.termination = termination
        self.logURL = logURL
        self.logOffset = logOffset
    }

    /// `baseEnvironment` is what the engine inherits before `command.environment` is added: the app passes its own
    /// with the login shell's `PATH` (`LoginShellPath`).
    static func start(
        _ command: EngineCommand, socketPath: String, logURL: URL,
        baseEnvironment: [String: String] = ProcessInfo.processInfo.environment
    ) throws(EngineFailure) -> EngineProcess {
        let log: FileHandle
        let offset: UInt64
        do {
            try FileManager.default.createDirectory(
                at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            let fd = open(logURL.path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0o600)
            guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
            log = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
            offset = try log.seekToEnd()
        } catch {
            throw EngineFailure(code: .engineStartFailed, message: "Could not open \(logURL.path): \(error.localizedDescription)")
        }

        let process = Process()
        process.executableURL = command.executable
        process.arguments = command.arguments + ["--socket", socketPath]
        process.environment = baseEnvironment.merging(command.environment) { _, added in added }
        let stdout = Pipe()
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = stdout
        process.standardError = log
        let termination = OneShot<Termination>()
        process.terminationHandler = { finished in
            termination.resolve(finished.terminationReason == .uncaughtSignal
                ? .signaled(finished.terminationStatus) : .exited(finished.terminationStatus))
        }
        do {
            try process.run()
        } catch {
            throw EngineFailure(
                code: .engineNotFound, message: "Could not run \(command.executable.path): \(error.localizedDescription)")
        }
        try? stdout.fileHandleForWriting.close()
        return EngineProcess(
            process: process, stdout: stdout.fileHandleForReading, termination: termination, logURL: logURL, logOffset: offset)
    }

    /// Waits for the ready line (`{"ready":true,...}`), the process's exit, or the timeout, whichever comes first.
    func waitUntilReady(timeout: Duration, clock: any Clock<Duration>) async -> Readiness {
        await withTaskGroup(of: Readiness?.self) { group in
            group.addTask { await self.readyLine() }
            group.addTask { await self.termination.wait().map(Readiness.exited) }
            group.addTask {
                do {
                    try await clock.sleep(for: timeout)
                    return .timedOut
                } catch {
                    return nil
                }
            }
            var outcome = Readiness.timedOut
            for await finished in group {
                guard let finished else { continue }
                outcome = finished
                break
            }
            if outcome == .timedOut { kill() }
            group.cancelAll()
            return outcome
        }
    }

    func waitForExit() async -> Termination? {
        await termination.wait()
    }

    /// Sends SIGTERM and waits for the exit; sends SIGKILL if the engine is still running after `grace`.
    func stop(grace: Duration, clock: any Clock<Duration>) async {
        terminate()
        let exitedInTime = await withTaskGroup(of: Bool.self) { group in
            group.addTask { await self.termination.wait() != nil }
            group.addTask {
                try? await clock.sleep(for: grace)
                return false
            }
            let first = await group.next() ?? false
            group.cancelAll()
            return first
        }
        if !exitedInTime {
            kill()
            _ = await termination.wait()
        }
    }

    func terminate() {
        Darwin.kill(processIdentifier, SIGTERM)
    }

    func kill() {
        Darwin.kill(processIdentifier, SIGKILL)
    }

    /// The last line `picad` logged in this run, without its JSON envelope (`{ts, level, component, msg}`).
    func lastLogMessage() -> String? {
        guard let handle = try? FileHandle(forReadingFrom: logURL) else { return nil }
        defer { try? handle.close() }
        guard (try? handle.seek(toOffset: logOffset)) != nil, let data = try? handle.readToEnd() else { return nil }
        let lines = String(decoding: data, as: UTF8.self).split(whereSeparator: \.isNewline)
        guard let last = lines.last.map(String.init) else { return nil }
        struct Entry: Decodable { var msg: String }
        return (try? JSONDecoder().decode(Entry.self, from: Data(last.utf8)))?.msg ?? last
    }

    /// Returns `.ready` on the ready line; nil when stdout closes first, since the exit then decides the outcome.
    private func readyLine() async -> Readiness? {
        do {
            for try await line in stdout.bytes.lines where Self.isReady(line) {
                return .ready
            }
        } catch {
            // A read error means the pipe is gone; the process's exit decides the outcome.
        }
        return nil
    }

    static func isReady(_ line: String) -> Bool {
        struct ReadyLine: Decodable { var ready: Bool }
        return (try? JSONDecoder().decode(ReadyLine.self, from: Data(line.utf8)))?.ready == true
    }
}
