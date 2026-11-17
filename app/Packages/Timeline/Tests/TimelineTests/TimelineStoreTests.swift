import PicaProtocol
import Testing
@testable import Timeline

@MainActor
@Suite struct TimelineStoreTests {
    private func store(_ items: [(String, String)], historySeq: Seq = 0) -> TimelineStore {
        let store = TimelineStore(sessionId: EventFixtures.sessionId, historySeq: historySeq)
        store.apply(contentsOf: EventFixtures.events(items))
        return store
    }

    @Test func deltasStreamIntoOneMessageThatTheWholeMessageReplaces() throws {
        let store = store([
            ("assistant.delta", #"{"messageId":"m","agent":"main","text":"Hel"}"#),
            ("assistant.delta", #"{"messageId":"m","agent":"main","text":"lo"}"#),
        ])
        guard case .assistant(let message) = try #require(store.entries.only) else {
            Issue.record("expected one assistant row, got \(store.entries.map(\.id))")
            return
        }
        #expect(message.text == "Hello")
        #expect(message.isStreaming)
        store.apply(contentsOf: [EventFixtures.events([("assistant.message", #"{"messageId":"m","agent":"main","text":"Hello."}"#)])[0].withSeq(3)])
        #expect(message.text == "Hello.")
        #expect(!message.isStreaming)
    }

    @Test func aToolCallIsOneRowThatItsResultAndPolicyDecisionUpdate() throws {
        let store = store([
            EventFixtures.toolStarted,
            ("policy.decision", #"{"ruleId":"permission.read-only","ruleGroup":"permission","outcome":"allow","reason":"Read-only","toolCallId":"t-1","toolName":"view","agent":"main"}"#),
            EventFixtures.toolCompleted,
        ])
        guard case .tool(let tool) = try #require(store.entries.only) else {
            Issue.record("expected one tool row, got \(store.entries.map(\.id))")
            return
        }
        #expect(tool.decision?.ruleId == "permission.read-only")
        #expect(tool.status == .completed(preview: tool.status.preview ?? "", bytes: 2140, spilledPath: nil))
    }

    @Test func onlyDecisionsThatDidNotAllowGetARow() {
        let store = store([
            ("policy.decision", #"{"ruleId":"a","ruleGroup":"permission","outcome":"allow","reason":"ok","toolCallId":"t-1","toolName":"view","agent":"main"}"#),
            ("policy.decision", #"{"ruleId":"b","ruleGroup":"cost","outcome":"deny","reason":"no","toolCallId":"t-2","toolName":"view","agent":"main"}"#),
        ])
        #expect(store.entries.map(\.id) == ["policy.2"])
    }

    @Test func aSubagentTakesTheRowOfItsTaskCallAndCollectsWhatItDoes() throws {
        let fixture = try #require(EventFixtures.byType["subagent.completed"])
        let store = store(fixture.events)
        guard case .subagent(let group) = try #require(store.entries.only) else {
            Issue.record("expected one sub-agent group, got \(store.entries.map(\.id))")
            return
        }
        #expect(group.children.map(\.id) == ["tool.t-10", "assistant.m-9"])
        #expect(group.model == "model-c")
        #expect(group.requestedModel == "model-b")
        #expect(group.status == .completed(totalTokens: 18420, durationMs: 7300))
        // Once the sub-agent finished, the main agent's rows are top-level again.
        store.apply(contentsOf: [EventFixtures.events([EventFixtures.toolStarted])[0].withSeq(7)])
        #expect(store.entries.map(\.id) == ["subagent.t-9", "tool.t-1"])
    }

    @Test func aBudgetApprovalAnnouncedTwiceIsOneRowThatItsResolutionUpdates() throws {
        let store = store([
            ("budget.exhausted", #"{"spentCredits":10,"limitCredits":10,"approvalId":"a-3"}"#),
            ("approval.requested", #"{"id":"a-3","sessionId":"s-1","kind":"budget","toolCallId":null,"summary":"More budget?"}"#),
            ("approval.resolved", #"{"approvalId":"a-3","choice":"allow_once"}"#),
        ])
        guard case .approval(let approval) = try #require(store.entries.only) else {
            Issue.record("expected one approval row, got \(store.entries.map(\.id))")
            return
        }
        #expect(approval.kind == .budget(spentCredits: 10, limitCredits: 10))
        #expect(approval.choice == .allowOnce)
    }

    @Test func usageAddsUpAndContextUseIsTheLatest() {
        let usage = #"{"sessionId":"s-1","agent":"main","model":"m","inputTokens":100,"cachedInputTokens":40,"outputTokens":10,"credits":0.5,"timestamp":"2026-11-16T10:00:00.000Z"}"#
        let store = store([
            ("usage.recorded", usage), ("usage.recorded", usage),
            ("context.usage", #"{"currentTokens":10,"tokenLimit":100}"#),
            ("context.usage", #"{"currentTokens":50,"tokenLimit":100}"#),
        ])
        #expect(store.usage.totalTokens == 220)
        #expect(store.usage.cachedInputTokens == 80)
        #expect(store.usage.credits == 1)
        #expect(store.usage.contextFraction == 0.5)
        #expect(store.entries.isEmpty)
    }

    @Test func onlyStatesThatEndOrStopTheSessionGetARow() {
        let store = store([
            ("session.state_changed", #"{"from":null,"to":"starting"}"#),
            ("session.state_changed", #"{"from":"starting","to":"running"}"#),
            ("session.state_changed", #"{"from":"running","to":"idle"}"#),
            ("session.state_changed", #"{"from":"idle","to":"ended"}"#),
        ])
        #expect(store.entries.map(\.id) == ["notice.4"])
        #expect(store.state == .ended)
    }

    @Test func eventsAtOrBelowTheLastSeqAreIgnored() {
        let store = store([EventFixtures.user])
        store.apply(contentsOf: EventFixtures.events([EventFixtures.user]))
        #expect(store.entries.count == 1)
    }

    @Test func itHasCaughtUpOnceTheHistoryIsApplied() {
        let store = TimelineStore(sessionId: EventFixtures.sessionId, historySeq: 2)
        store.apply(contentsOf: EventFixtures.events([EventFixtures.user]))
        #expect(!store.hasCaughtUp)
        store.apply(contentsOf: [EventFixtures.events([EventFixtures.user])[0].withSeq(2)])
        #expect(store.hasCaughtUp)
        #expect(TimelineStore(sessionId: "empty", historySeq: 0).hasCaughtUp)
    }

    @Test func followAppliesAStreamAndRecordsHowItEnded() async {
        let store = TimelineStore(sessionId: EventFixtures.sessionId, historySeq: 2)
        let (events, continuation) = AsyncThrowingStream<SessionEvent, any Error>.makeStream()
        for event in EventFixtures.events([EventFixtures.user, EventFixtures.toolStarted]) {
            continuation.yield(event)
        }
        continuation.finish(throwing: Failure())
        await store.follow(events)
        #expect(store.entries.map(\.id) == ["user.1", "tool.t-1"])
        #expect(store.hasCaughtUp)
        #expect(store.failure != nil)
    }

    private struct Failure: Error {}
}

extension Array {
    var only: Element? { count == 1 ? first : nil }
}

extension ToolCallItem.Status {
    var preview: String? {
        if case .completed(let preview, _, _) = self { return preview }
        return nil
    }
}
