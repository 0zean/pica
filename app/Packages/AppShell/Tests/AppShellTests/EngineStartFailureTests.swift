@testable import AppShell
import EngineClient
import EngineClientTestSupport
import Foundation
import Testing

/// When `picad` exits before its ready line (E-11: config or store cannot be opened), the app says why.
@Suite(.serialized, .timeLimit(.minutes(1))) struct EngineStartFailureTests {
    @Test func engineThatExitsBeforeReadyIsReportedWithItsExitCodeAndMessage() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        try FileManager.default.createDirectory(at: fixture.dataDirectory, withIntermediateDirectories: true)
        try Data(#"{ "routing": 5"#.utf8).write(to: fixture.dataDirectory.appending(path: "config.jsonc"))
        var configuration = EngineSupervisor.Configuration()
        configuration.restartDelays = [.zero]
        let supervisor = try fixture.supervisor(configuration: configuration)
        var statuses = await supervisor.statuses().makeAsyncIterator()
        await supervisor.start()

        let status = await nextStatus(&statuses) { $0.isFailed }
        guard case .failed(let failure)? = status else { return }
        #expect(failure.code == .engineStartFailed)
        #expect(failure.message.contains("exited with code 1 before it was ready"))
        #expect(failure.message.contains("config.jsonc"), "the message names the file: \(failure.message)")
        #expect(failure.message.contains(fixture.logURL.path))
        let presentation = EngineStatusPresentation(failure)
        #expect(presentation.style == .blocking)
        #expect(presentation.offersRetry)
        #expect(presentation.code == "engine_start_failed")

        // Fixing the config and retrying starts the engine.
        try FileManager.default.removeItem(at: fixture.dataDirectory.appending(path: "config.jsonc"))
        await supervisor.retry()
        _ = await nextStatus(&statuses) { $0.isConnected }
        await supervisor.stop()
    }

    @Test func missingEngineIsReportedWithoutStartingAnything() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        let missing = EngineCommand.resolve(environment: [:], bundle: Bundle(for: BundleMarker.self))
        let supervisor = EngineSupervisor(command: missing, socketPath: fixture.socketPath, secrets: InMemorySecretBroker())
        var statuses = await supervisor.statuses().makeAsyncIterator()
        await supervisor.start()
        let status = await nextStatus(&statuses) { $0.isFailed }
        guard case .failed(let failure)? = status else { return }
        #expect(failure.code == .engineNotFound)
        #expect(failure.message.contains("Contents/Helpers/node is missing"))
        await supervisor.stop()
    }
}

private final class BundleMarker {}

extension EngineStatusPresentation {
    init(_ failure: EngineFailure) {
        self.init(.failed(failure))
    }
}
