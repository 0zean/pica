@testable import AppShell
import EngineClient
import EngineClientTestSupport
import Foundation
import PicaProtocol
import Testing

/// PLAN.md A-01: a protocol major mismatch shows a blocking error naming both versions.
@Suite(.serialized, .timeLimit(.minutes(1))) struct ProtocolMismatchTests {
    /// The real engine refuses an app that speaks protocol 2.0; the app stops restarting it and blocks.
    @MainActor @Test func engineOfAnotherMajorShowsABlockingErrorNamingBothVersions() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        var clientConfiguration = EngineSupervisor.clientConfiguration()
        clientConfiguration.protocolVersion = ProtocolVersion(major: 2, minor: 0)
        let supervisor = try fixture.supervisor(clientConfiguration: clientConfiguration)
        let model = AppModel(supervisor: supervisor)
        var shown = Observations { model.presentation }.makeAsyncIterator()
        model.start()
        var presentation = await shown.next()
        while let current = presentation, current.style != .blocking {
            presentation = await shown.next()
        }

        #expect(model.engineStatus == .incompatible(
            app: ProtocolVersion(major: 2, minor: 0), engine: ProtocolVersion(major: 1, minor: 0)))
        let blocking = try #require(presentation)
        #expect(blocking.title == "This engine can't be used")
        #expect(blocking.message.contains("Pica speaks protocol 2.0"))
        #expect(blocking.message.contains("the engine speaks protocol 1.0"))
        #expect(blocking.code == "protocol_version_mismatch")
        #expect(!blocking.offersRetry)
        // The refused engine is stopped, not restarted.
        #expect(supervisor.engineProcessIdentifier == nil)
        await supervisor.stop()
    }

    /// A reconnect that reaches an engine of another major (an update replaced it) also blocks.
    @Test func mismatchAfterAReconnectBlocks() async throws {
        let server = try ScriptedEngineServer()
        let supervisor = EngineSupervisor(
            command: .failure(EngineFailure(code: .engineNotFound, message: "not used")),
            socketPath: server.socketPath, secrets: InMemorySecretBroker())
        var statuses = await supervisor.statuses().makeAsyncIterator()
        await supervisor.start()
        let first = try await server.nextPeer()
        try await first.acceptHello()
        _ = await nextStatus(&statuses) { $0.isConnected }

        await first.disconnect()
        let second = try await server.nextPeer()
        let hello = try await second.receiveRequest(Methods.EngineHello.name)
        try await second.respond(to: hello, error: RpcError(
            code: RpcErrorNumber.application.rawValue,
            message: "This engine speaks protocol 3.x; the client speaks 1.x.",
            data: ErrorData(code: .protocolVersionMismatch, details: [
                "engine": .object(["major": .number(3), "minor": .number(1)]),
                "client": .object(["major": .number(1), "minor": .number(0)]),
            ])))

        let status = await nextStatus(&statuses) { if case .incompatible = $0 { true } else { false } }
        #expect(status == .incompatible(app: .current, engine: ProtocolVersion(major: 3, minor: 1)))
        let presentation = EngineStatusPresentation(try #require(status))
        #expect(presentation.style == .blocking)
        #expect(presentation.message.contains("Pica speaks protocol \(ProtocolVersion.current.displayed)"))
        #expect(presentation.message.contains("the engine speaks protocol 3.1"))
        await supervisor.stop()
        await server.stop()
    }
}
