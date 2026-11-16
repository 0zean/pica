@testable import AppShell
import EngineClient
import EngineClientTestSupport
import Foundation
import PicaProtocol
import Testing

/// A real `picad` composed with a FakeRuntime (`engine/packages/server/tests/processes/fake-picad.ts`), started by
/// the supervisor the way the app starts the bundled engine. Each fixture has its own home and socket directory.
struct EngineFixture {
    static let repository = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    static let entry = repository.appending(path: "engine/packages/server/tests/processes/fake-picad.ts")

    let home: URL
    let socketPath: String

    init() throws {
        // Short, so the socket path stays within sun_path's 104 bytes.
        home = URL(filePath: "/tmp").appending(path: "pica-a01-\(UUID().uuidString.prefix(8))")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        socketPath = home.appending(path: "run/picad.sock").path
    }

    var dataDirectory: URL { home.appending(path: "Library/Application Support/Pica") }
    var logURL: URL { home.appending(path: "run/picad.log") }

    func command() throws -> EngineCommand {
        var command = EngineCommand.development(node: try Self.node(), entry: Self.entry)
        command.environment = ["PICA_TEST_HOME": home.path]
        return command
    }

    func supervisor(
        clientConfiguration: EngineClient.Configuration = EngineSupervisor.clientConfiguration(),
        configuration: EngineSupervisor.Configuration = EngineSupervisor.Configuration()
    ) throws -> EngineSupervisor {
        EngineSupervisor(
            command: .success(try command()), socketPath: socketPath, secrets: InMemorySecretBroker(),
            clientConfiguration: clientConfiguration, configuration: configuration)
    }

    func remove() {
        try? FileManager.default.removeItem(at: home)
    }

    /// `PICA_NODE`, else the first `node` on `PATH`. The engine needs Node 22.13 or later (`engine/package.json`).
    static func node() throws -> URL {
        let environment = ProcessInfo.processInfo.environment
        if let node = environment["PICA_NODE"] { return URL(filePath: node) }
        for directory in (environment["PATH"] ?? "").split(separator: ":") {
            let candidate = URL(filePath: String(directory)).appending(path: "node")
            if FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate }
        }
        throw FixtureError.nodeNotFound
    }

    enum FixtureError: Error {
        case nodeNotFound
    }
}

/// Reads statuses until one matches, failing when the stream ends first.
func nextStatus(
    _ statuses: inout AsyncStream<EngineStatus>.AsyncIterator,
    sourceLocation: SourceLocation = #_sourceLocation,
    where matches: (EngineStatus) -> Bool
) async -> EngineStatus? {
    while let status = await statuses.next() {
        if matches(status) { return status }
    }
    Issue.record("the status stream ended", sourceLocation: sourceLocation)
    return nil
}

extension EngineStatus {
    var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }

    var isFailed: Bool {
        if case .failed = self { return true }
        return false
    }
}
