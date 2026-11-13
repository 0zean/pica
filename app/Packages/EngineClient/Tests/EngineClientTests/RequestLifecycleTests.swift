import EngineClient
import EngineClientTestSupport
import Foundation
import PicaProtocol
import Testing

/// PLAN.md A-02: request timeout and task cancellation behave as specified in docs/engine-client.md.
@Suite(.timeLimit(.minutes(1))) struct RequestLifecycleTests {
    private let health = EngineHealthResult(status: .ok, uptimeMs: 5, sessionsRunning: 0)

    @Test func requestTimesOutAfterTheConfiguredDurationOnTheInjectedClock() async throws {
        let harness = try await Harness.connected { $0.requestTimeout = .seconds(5) }
        let call = Task { try await harness.client.request(Methods.EngineHealth.self) }
        let sent = try await harness.peer.receiveRequest(Methods.EngineHealth.name)

        await harness.clock.waitForSleepers(1)
        harness.clock.advance(by: .milliseconds(4_999))
        #expect(harness.clock.sleeperCount == 1)
        harness.clock.advance(by: .milliseconds(1))
        await #expect(throws: EngineClientError.timedOut(method: "engine.health", after: .seconds(5))) {
            try await call.value
        }

        // A late answer is dropped, and the connection stays usable.
        try await harness.peer.respond(to: sent, with: health)
        try await expectNextRequestSucceeds(harness)
        await harness.shutDown()
    }

    @Test func perCallTimeoutOverridesTheDefault() async throws {
        let harness = try await Harness.connected { $0.requestTimeout = .seconds(30) }
        let call = Task { try await harness.client.request(Methods.EngineHealth.self, timeout: .seconds(1)) }
        _ = try await harness.peer.receiveRequest(Methods.EngineHealth.name)
        await harness.clock.waitForSleepers(1)
        harness.clock.advance(by: .seconds(1))
        await #expect(throws: EngineClientError.timedOut(method: "engine.health", after: .seconds(1))) {
            try await call.value
        }
        await harness.shutDown()
    }

    @Test func answeredRequestCancelsItsTimer() async throws {
        let harness = try await Harness.connected()
        try await expectNextRequestSucceeds(harness)
        #expect(harness.clock.sleeperCount == 0)
        await harness.shutDown()
    }

    @Test func cancellingTheCallerThrowsCancellationErrorAndDropsTheLateAnswer() async throws {
        let harness = try await Harness.connected()
        let call = Task { try await harness.client.request(Methods.EngineHealth.self) }
        let sent = try await harness.peer.receiveRequest(Methods.EngineHealth.name)
        await harness.clock.waitForSleepers(1)

        call.cancel()
        await #expect(throws: CancellationError.self) { try await call.value }
        #expect(harness.clock.sleeperCount == 0)

        try await harness.peer.respond(to: sent, with: health)
        try await expectNextRequestSucceeds(harness)
        await harness.shutDown()
    }

    @Test func callerCancelledBeforeSendingWritesNothing() async throws {
        let harness = try await Harness.connected()
        let call = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await harness.client.request(Methods.EngineHealth.self)
        }
        await #expect(throws: CancellationError.self) { try await call.value }

        // The next line the engine sees is the following request, not the cancelled one.
        async let models = harness.client.request(Methods.ModelsList.self)
        let next = try await harness.peer.receive()
        #expect(next.method == Methods.ModelsList.name)
        try await harness.peer.respond(to: next, with: ModelsListResult(models: [], fetchedAt: "2026-11-13T09:00:00.000Z"))
        _ = try await models
        await harness.shutDown()
    }

    @Test func losingTheConnectionFailsPendingRequestsWithDisconnected() async throws {
        let harness = try await Harness.connected()
        let call = Task { try await harness.client.request(Methods.EngineHealth.self) }
        _ = try await harness.peer.receiveRequest(Methods.EngineHealth.name)
        await harness.peer.disconnect()
        await #expect(throws: EngineClientError.disconnected) { try await call.value }
        await harness.shutDown()
    }

    @Test func closeFailsPendingRequestsWithClosed() async throws {
        let harness = try await Harness.connected()
        let call = Task { try await harness.client.request(Methods.EngineHealth.self) }
        _ = try await harness.peer.receiveRequest(Methods.EngineHealth.name)
        await harness.client.close()
        await #expect(throws: EngineClientError.closed) { try await call.value }
        await harness.server.stop()
    }

    @Test func requestBeforeConnectingFailsWithNotConnected() async throws {
        let client = EngineClient(socketPath: "/nonexistent/picad.sock", secrets: InMemorySecretBroker(), clock: ManualClock())
        await #expect(throws: EngineClientError.notConnected) {
            try await client.request(Methods.EngineHealth.self)
        }
    }

    @Test func engineErrorIsThrownWithItsStableCode() async throws {
        let harness = try await Harness.connected()
        let call = Task { try await harness.client.request(Methods.SessionGet.self, BySession(sessionId: "ses_missing")) }
        let sent = try await harness.peer.receiveRequest(Methods.SessionGet.name)
        let notFound = RpcError(code: -32000, message: "No session ses_missing.", data: ErrorData(code: .notFound))
        try await harness.peer.respond(to: sent, error: notFound)
        do {
            _ = try await call.value
            Issue.record("expected an engine error")
        } catch let error as EngineClientError {
            #expect(error.code == .notFound)
        }
        await harness.shutDown()
    }

    private func expectNextRequestSucceeds(_ harness: Harness) async throws {
        let call = Task { try await harness.client.request(Methods.EngineHealth.self) }
        let sent = try await harness.peer.receiveRequest(Methods.EngineHealth.name)
        try await harness.peer.respond(to: sent, with: health)
        #expect(try await call.value == health)
    }
}
