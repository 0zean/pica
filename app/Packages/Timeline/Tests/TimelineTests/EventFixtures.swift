import Foundation
import PicaProtocol

/// Small event logs, one per event type, each with whatever must come before it for its row to show.
/// They are written as the engine sends them and decoded with the protocol's own types.
enum EventFixtures {
    static let sessionId = "s-1"

    /// Every event type the protocol defines, read from `protocol.schema.json`, so a new type without a fixture fails.
    static func protocolEventTypes() throws -> Set<String> {
        let schema = repository.appending(path: "engine/packages/protocol/protocol.schema.json")
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: schema)) as? [String: Any]
        let events = object?["x-pica-events"] as? [String: Any] ?? [:]
        return Set(events.keys)
    }

    static let repository = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    /// Decodes `(type, payload)` pairs into events with consecutive `seq`s.
    static func events(_ items: [(String, String)]) -> [SessionEvent] {
        let decoder = JSONDecoder()
        return items.enumerated().map { index, item in
            let json = """
                {"sessionId":"\(sessionId)","seq":\(index + 1),"timestamp":"2026-11-16T10:00:\(String(format: "%02d", index % 60)).000Z","type":"\(item.0)","payload":\(item.1)}
                """
            do {
                return try decoder.decode(SessionEvent.self, from: Data(json.utf8))
            } catch {
                fatalError("fixture \(item.0) does not decode: \(error)")
            }
        }
    }

    static let user = ("user.message", #"{"text":"Find where the router picks a tier and add a test for it.","mode":"send"}"#)
    static let toolStarted = (
        "tool.started",
        #"{"toolCallId":"t-1","toolName":"view","agent":"main","parentToolCallId":null,"arguments":{"path":"engine/packages/core/src/routing/route.ts"}}"#
    )
    static let toolCompleted = (
        "tool.completed",
        #"{"toolCallId":"t-1","toolName":"view","agent":"main","parentToolCallId":null,"resultPreview":"export function route(call: ToolCall): Tier {\n  return call.size > 4096 ? \"bulk\" : \"main\";\n}","resultBytes":2140,"spilledArtifactPath":null}"#
    )
    static let taskStarted = (
        "tool.started",
        #"{"toolCallId":"t-9","toolName":"task","agent":"main","parentToolCallId":null,"arguments":{"agent_type":"bulk-reader","prompt":"Find every caller of route()"}}"#
    )
    static let subagentStarted = ("subagent.started", #"{"toolCallId":"t-9","agent":"bulk-reader","model":"model-b"}"#)
    static let subagentTool = (
        "tool.started",
        #"{"toolCallId":"t-10","toolName":"grep","agent":"bulk-reader","parentToolCallId":"t-9","arguments":{"pattern":"route("}}"#
    )
    static let subagentToolDone = (
        "tool.completed",
        #"{"toolCallId":"t-10","toolName":"grep","agent":"bulk-reader","parentToolCallId":"t-9","resultPreview":"12 matches in 4 files","resultBytes":512,"spilledArtifactPath":null}"#
    )
    static let subagentText = (
        "assistant.message", #"{"messageId":"m-9","agent":"bulk-reader","text":"Found **12** callers in 4 files."}"#
    )

    static let markdown = """
        ## Where the tier is chosen

        `route()` in **route.ts** picks the tier from the call's *size*:

        1. Reads over 4 KB go to the bulk tier.
        2. Everything else stays on the main agent.

        ```ts
        expect(route(bigRead)).toBe("bulk");
        ```

        | Call | Tier |
        |---|---|
        | small read | main |
        | large read | bulk |

        > The threshold comes from `routing.largeRead`.
        """

    static func jsonString(_ text: String) -> String {
        String(decoding: try! JSONEncoder().encode(text), as: UTF8.self)
    }

    /// The fixture for each event type: the events, and the rows to expand before rendering.
    static let byType: [String: (events: [(String, String)], expand: Set<String>)] = [
        "session.state_changed": (
            [("session.state_changed", #"{"from":null,"to":"running"}"#),
             ("session.state_changed", #"{"from":"running","to":"failed"}"#)], []),
        "user.message": (
            [user, ("user.message", #"{"text":"Use the existing fixture instead.","mode":"steer"}"#),
             ("user.message", #"{"text":"Then update the docs.","mode":"queue"}"#)], []),
        "assistant.delta": (
            [user,
             ("assistant.delta", ###"{"messageId":"m-1","agent":"main","text":"## Where the tier is chosen\n\n`route()` in **route.ts** picks"}"###),
             ("assistant.delta", #"{"messageId":"m-1","agent":"main","text":" the tier from the call's *size*:\n\n```ts\nexpect(route("}"#)], []),
        "assistant.message": ([user, ("assistant.message", "{\"messageId\":\"m-1\",\"agent\":\"main\",\"text\":" + jsonString(markdown) + "}")], []),
        "tool.started": ([toolStarted], []),
        "tool.completed": ([toolStarted, toolCompleted, ("tool.started", #"{"toolCallId":"t-2","toolName":"grep","agent":"main","parentToolCallId":null,"arguments":{"pattern":"largeRead","path":"engine"}}"#), ("tool.completed", #"{"toolCallId":"t-2","toolName":"grep","agent":"main","parentToolCallId":null,"resultPreview":"3 matches","resultBytes":96,"spilledArtifactPath":"/tmp/pica/spill/t-2.txt"}"#)], ["tool.t-1"]),
        "tool.failed": (
            [("tool.started", #"{"toolCallId":"t-3","toolName":"edit","agent":"main","parentToolCallId":null,"arguments":{"path":"README.md"}}"#),
             ("tool.failed", #"{"toolCallId":"t-3","toolName":"edit","agent":"main","parentToolCallId":null,"error":"The file changed on disk since it was read."}"#)],
            ["tool.t-3"]),
        "subagent.started": ([taskStarted, subagentStarted, subagentTool], ["subagent.t-9"]),
        "subagent.completed": (
            [taskStarted, subagentStarted, subagentTool, subagentToolDone, subagentText,
             ("subagent.completed", #"{"toolCallId":"t-9","agent":"bulk-reader","model":"model-c","requestedModel":"model-b","totalTokens":18420,"durationMs":7300}"#)],
            ["subagent.t-9"]),
        "subagent.failed": (
            [taskStarted, subagentStarted, ("subagent.failed", #"{"toolCallId":"t-9","agent":"bulk-reader","error":"The sub-agent hit its turn limit."}"#)],
            ["subagent.t-9"]),
        "policy.decision": (
            [toolStarted,
             ("policy.decision", #"{"ruleId":"cost.large-read","ruleGroup":"cost","outcome":"deny","reason":"Reads over 4 KB on the main agent go to the bulk tier.","toolCallId":"t-1","toolName":"view","agent":"main"}"#),
             ("policy.decision", #"{"ruleId":"permission.ask","ruleGroup":"permission","outcome":"ask","reason":"Writes outside the read-only set need approval.","toolCallId":"t-4","toolName":"edit","agent":"main"}"#),
             ("policy.decision", #"{"ruleId":"cost.oversized-output","ruleGroup":"cost","outcome":"rewrite","reason":"Output over 16 KB is truncated.","toolCallId":"t-5","toolName":"bash","agent":"main"}"#)],
            ["tool.t-1"]),
        "approval.requested": (
            [("approval.requested", #"{"id":"a-1","sessionId":"s-1","kind":"tool_call","toolCallId":"t-4","summary":"Edit README.md"}"#)], []),
        "approval.resolved": (
            [("approval.requested", #"{"id":"a-1","sessionId":"s-1","kind":"tool_call","toolCallId":"t-4","summary":"Edit README.md"}"#),
             ("approval.resolved", #"{"approvalId":"a-1","choice":"allow_once"}"#),
             ("approval.requested", #"{"id":"a-2","sessionId":"s-1","kind":"tool_call","toolCallId":"t-6","summary":"Run rm -rf build"}"#),
             ("approval.resolved", #"{"approvalId":"a-2","choice":"deny"}"#)], []),
        "usage.recorded": (
            [user, ("usage.recorded", #"{"sessionId":"s-1","agent":"main","model":"model-a","inputTokens":12000,"cachedInputTokens":8000,"outputTokens":640,"credits":1.25,"timestamp":"2026-11-16T10:00:00.000Z"}"#)], []),
        "context.usage": ([user, ("context.usage", #"{"currentTokens":98000,"tokenLimit":128000}"#)], []),
        "budget.warning": ([("budget.warning", #"{"spentCredits":8,"limitCredits":10}"#)], []),
        "budget.exhausted": ([("budget.exhausted", #"{"spentCredits":10,"limitCredits":10,"approvalId":"a-3"}"#)], []),
        "session.aborted": (
            [("session.aborted", #"{"reason":"user"}"#), ("session.aborted", #"{"reason":"budget"}"#), ("session.aborted", #"{"reason":"engine"}"#)], []),
        "session.error": ([("session.error", #"{"code":"runtime.failed","message":"The Copilot runtime stopped responding."}"#)], []),
        "runtime.unknown": (
            [("runtime.unknown", #"{"runtimeType":"session.compaction_start","raw":{"type":"session.compaction_start","data":{"reason":"context"}}}"#)],
            ["notice.1"]),
    ]

    /// An event type this build does not know, as a newer engine might send.
    static let newerEngine = [("plan.updated", #"{"steps":3}"#)]
}
