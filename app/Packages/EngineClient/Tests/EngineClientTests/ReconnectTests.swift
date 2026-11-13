import EngineClient
import EngineClientTestSupport
import Foundation
import PicaProtocol
import Testing

/// PLAN.md A-02: against a scripted socket server, reconnect resumes at `seq + 1` with no duplicate.
@Suite(.timeLimit(.minutes(1))) struct ReconnectTests {
    @Test func reconnectResumesAfterTheLastDeliveredSeqWithoutDuplicates() async throws {
        let harness = try await Harness.connected()
        let stream = await harness.client.events(sessionId: "ses_1", afterSeq: 0)
        var events = stream.makeAsyncIterator()

        // The engine replays the log before it answers events.subscribe (E-07).
        let subscribe = try await harness.peer.receiveRequest(Methods.EventsSubscribe.name)
        #expect(subscribe.param("sessionId") == .string("ses_1"))
        #expect(subscribe.param("afterSeq") == .number(0))
        try await harness.peer.sendEvent(subscriptionId: "sub_a", sessionId: "ses_1", seq: 1)
        try await harness.peer.sendEvent(subscriptionId: "sub_a", sessionId: "ses_1", seq: 2)
        try await harness.peer.respond(to: subscribe, with: EventsSubscribeResult(subscriptionId: "sub_a", lastSeq: 2))
        try await harness.peer.sendEvent(subscriptionId: "sub_a", sessionId: "ses_1", seq: 3)
        #expect(try await events.next()?.seq == 1)
        #expect(try await events.next()?.seq == 2)
        #expect(try await events.next()?.seq == 3)

        await harness.peer.disconnect()

        // The first reconnect attempt is immediate, so no clock advance is needed.
        let second = try await harness.server.nextPeer()
        try await second.acceptHello()
        let resubscribe = try await second.receiveRequest(Methods.EventsSubscribe.name)
        #expect(resubscribe.param("sessionId") == .string("ses_1"))
        #expect(resubscribe.param("afterSeq") == .number(3))
        // An engine that replays inclusively, or a second copy of a live event, must not reach the stream.
        try await second.sendEvent(subscriptionId: "sub_b", sessionId: "ses_1", seq: 3)
        try await second.sendEvent(subscriptionId: "sub_b", sessionId: "ses_1", seq: 4)
        try await second.respond(to: resubscribe, with: EventsSubscribeResult(subscriptionId: "sub_b", lastSeq: 4))
        try await second.sendEvent(subscriptionId: "sub_b", sessionId: "ses_1", seq: 4)
        try await second.sendEvent(subscriptionId: "sub_b", sessionId: "ses_1", seq: 5)
        #expect(try await events.next()?.seq == 4)
        #expect(try await events.next()?.seq == 5)

        // Events for the old connection's subscription id are not routed to the stream.
        try await second.sendEvent(subscriptionId: "sub_a", sessionId: "ses_1", seq: 99)
        try await second.sendEvent(subscriptionId: "sub_b", sessionId: "ses_1", seq: 6)
        #expect(try await events.next()?.seq == 6)

        await harness.shutDown()
        #expect(try await events.next() == nil)
    }

    @Test func connectionStateReportsReconnectingThenConnected() async throws {
        let harness = try await Harness.connected()
        var states = await harness.client.connectionStates().makeAsyncIterator()
        guard case .connected = await states.next() else {
            Issue.record("expected connected")
            return
        }
        await harness.peer.disconnect()
        #expect(await states.next() == .reconnecting)
        let second = try await harness.server.nextPeer()
        try await second.acceptHello()
        guard case .connected = await states.next() else {
            Issue.record("expected connected after reconnect")
            return
        }
        await harness.shutDown()
    }

    @Test func failedReconnectAttemptsRetryAfterTheBackoffDelayOnTheClock() async throws {
        let harness = try await Harness.connected {
            $0.reconnectDelays = [.milliseconds(100), .seconds(1)]
        }
        await harness.server.stopListening()
        await harness.peer.disconnect()

        // Attempt 1 fails at once; the client then sleeps 100 ms on the injected clock.
        await harness.clock.waitForSleepers(1)
        harness.clock.advance(by: .milliseconds(100))
        // Attempt 2 fails too; the next delay is 1 s.
        await harness.clock.waitForSleepers(1)
        try await harness.server.startListening()
        harness.clock.advance(by: .milliseconds(999))
        #expect(harness.clock.sleeperCount == 1)
        harness.clock.advance(by: .milliseconds(1))

        let second = try await harness.server.nextPeer()
        try await second.acceptHello()
        var states = await harness.client.connectionStates().makeAsyncIterator()
        while let state = await states.next() {
            if case .connected = state { break }
        }
        await harness.shutDown()
    }

    @Test func protocolMismatchOnReconnectStopsReconnecting() async throws {
        let harness = try await Harness.connected()
        let stream = await harness.client.events(sessionId: "ses_1", afterSeq: 0)
        let subscribe = try await harness.peer.receiveRequest(Methods.EventsSubscribe.name)
        try await harness.peer.respond(to: subscribe, with: EventsSubscribeResult(subscriptionId: "sub_a", lastSeq: 0))
        await harness.peer.disconnect()

        let second = try await harness.server.nextPeer()
        let hello = try await second.receiveRequest(Methods.EngineHello.name)
        let mismatch = RpcError(
            code: RpcErrorNumber.application.rawValue, message: "Engine speaks 2.0.",
            data: ErrorData(code: .protocolVersionMismatch))
        try await second.respond(to: hello, error: mismatch)

        await #expect(throws: EngineClientError.engine(mismatch)) {
            for try await _ in stream {}
        }
        #expect(await harness.client.state == .refused(.engine(mismatch)))
        await harness.shutDown()
    }
}
