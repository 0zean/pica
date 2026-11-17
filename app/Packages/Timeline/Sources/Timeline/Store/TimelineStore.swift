import EngineClient
import Foundation
import Observation
import Synchronization
import PicaProtocol

/// One session's events folded into timeline rows (EngineClient → store → view, PLAN.md §8). Specified in
/// docs/session-timeline.md.
@Observable @MainActor
public final class TimelineStore {
    public let sessionId: Id
    public private(set) var entries: [TimelineEntry] = []
    public private(set) var usage = SessionUsageSummary()
    public private(set) var state: SessionState?
    public private(set) var lastSeq: Seq = 0
    /// Counts the batches of events applied; the view follows it to keep the newest row in sight.
    public private(set) var revision = 0
    /// True once every event the session had when it was opened has been applied.
    public private(set) var hasCaughtUp: Bool
    /// Why the event stream ended, when it ended with an error.
    public private(set) var failure: String?

    /// When the timeline was opened, for `TimelineMetrics`.
    @ObservationIgnored public let openedAt = ContinuousClock.now
    /// When the history had been applied, for `TimelineMetrics`.
    @ObservationIgnored public private(set) var caughtUpAt: ContinuousClock.Instant?
    @ObservationIgnored public private(set) var firstEventAt: ContinuousClock.Instant?
    /// The session's last `seq` when it was opened.
    @ObservationIgnored public let historySeq: Seq
    @ObservationIgnored private var topLevelIndex: [String: Int] = [:]
    @ObservationIgnored private var assistants: [Id: AssistantMessageItem] = [:]
    @ObservationIgnored private var tools: [Id: ToolCallItem] = [:]
    @ObservationIgnored private var subagents: [Id: SubagentItem] = [:]
    @ObservationIgnored private var runningSubagents: [String: SubagentItem] = [:]
    @ObservationIgnored private var approvals: [Id: ApprovalItem] = [:]

    public init(sessionId: Id, historySeq: Seq) {
        self.sessionId = sessionId
        self.historySeq = historySeq
        hasCaughtUp = historySeq == 0
    }

    /// Applies `events` until the stream ends or the calling task is cancelled. Events are read off the main actor
    /// and applied in batches, so a long history or a fast stream costs a few view updates rather than one per event.
    public func follow(_ events: AsyncThrowingStream<SessionEvent, any Error>) async {
        let buffer = EventBuffer()
        let (signals, signal) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let reader = Task.detached {
            do {
                for try await event in events {
                    buffer.append(event)
                    signal.yield()
                }
            } catch {
                buffer.fail(error)
            }
            signal.finish()
        }
        await withTaskCancellationHandler {
            for await _ in signals {
                apply(contentsOf: buffer.drain())
            }
            apply(contentsOf: buffer.drain())
        } onCancel: {
            reader.cancel()
        }
        if let error = buffer.failure, !Task.isCancelled {
            failure = String(describing: error)
        }
    }

    public func apply(contentsOf events: [SessionEvent]) {
        guard !events.isEmpty else { return }
        if firstEventAt == nil { firstEventAt = .now }
        for event in events {
            apply(event)
        }
        revision += 1
        if !hasCaughtUp, lastSeq >= historySeq {
            hasCaughtUp = true
            caughtUpAt = .now
        }
    }

    private func apply(_ event: SessionEvent) {
        let seq = event.seq
        guard seq > lastSeq else { return }
        lastSeq = seq
        switch event {
        case .sessionStateChanged(let event): stateChanged(seq, event.payload)
        case .userMessage(let event):
            appendTopLevel(.user(UserMessageItem(seq: seq, text: event.payload.text, mode: event.payload.mode)))
        case .assistantDelta(let event):
            assistant(event.payload.messageId, agent: event.payload.agent).append(event.payload.text)
        case .assistantMessage(let event):
            assistant(event.payload.messageId, agent: event.payload.agent).finish(event.payload.text)
        case .toolStarted(let event): toolStarted(event.payload)
        case .toolCompleted(let event):
            let payload = event.payload
            tool(payload.toolCallId, name: payload.toolName, agent: payload.agent, parent: payload.parentToolCallId)
                .status = .completed(
                    preview: payload.resultPreview, bytes: payload.resultBytes, spilledPath: payload.spilledArtifactPath)
        case .toolFailed(let event):
            let payload = event.payload
            tool(payload.toolCallId, name: payload.toolName, agent: payload.agent, parent: payload.parentToolCallId)
                .status = .failed(error: payload.error)
        case .subagentStarted(let event): subagentStarted(event.payload)
        case .subagentCompleted(let event): subagentCompleted(event.payload)
        case .subagentFailed(let event):
            let payload = event.payload
            let group = subagent(payload.toolCallId, agent: payload.agent)
            group.status = .failed(error: payload.error)
            runningSubagents[payload.agent] = nil
        case .policyDecision(let event): policyDecided(seq, event.payload)
        case .approvalRequested(let event): approvalRequested(event.payload)
        case .approvalResolved(let event): approvals[event.payload.approvalId]?.choice = event.payload.choice
        case .usageRecorded(let event):
            usage.inputTokens += event.payload.inputTokens
            usage.cachedInputTokens += event.payload.cachedInputTokens
            usage.outputTokens += event.payload.outputTokens
            usage.credits += event.payload.credits
        case .contextUsage(let event):
            usage.contextTokens = event.payload.currentTokens
            usage.contextLimit = event.payload.tokenLimit
        case .budgetWarning(let event):
            let payload = event.payload
            appendTopLevel(.notice(NoticeItem(
                seq: seq, tone: .warning, systemImage: "gauge.with.dots.needle.67percent",
                title: "Budget: \(Format.credits(payload.spentCredits)) of \(Format.credits(payload.limitCredits)) credits used")))
        case .budgetExhausted(let event):
            let payload = event.payload
            addApproval(
                payload.approvalId,
                kind: .budget(spentCredits: payload.spentCredits, limitCredits: payload.limitCredits),
                summary: "The session has used its budget of \(Format.credits(payload.limitCredits)) credits.")
        case .sessionAborted(let event):
            appendTopLevel(.notice(NoticeItem(
                seq: seq, tone: .neutral, systemImage: "stop.circle", title: Self.abortTitle(event.payload.reason))))
        case .sessionError(let event):
            appendTopLevel(.notice(NoticeItem(
                seq: seq, tone: .danger, systemImage: "exclamationmark.octagon", title: event.payload.message,
                caption: event.payload.code)))
        case .runtimeUnknown(let event):
            appendTopLevel(.notice(NoticeItem(
                seq: seq, tone: .neutral, systemImage: "questionmark.circle",
                title: "Unrecognized runtime event “\(event.payload.runtimeType)”", raw: Format.json(event.payload.raw))))
        case .unknown(let event):
            appendTopLevel(.notice(NoticeItem(
                seq: seq, tone: .neutral, systemImage: "questionmark.circle",
                title: "Event “\(event.type)” from a newer engine", raw: Format.json(event.payload))))
        }
    }

    // MARK: - Folding

    private func stateChanged(_ seq: Seq, _ payload: SessionStateChangedPayload) {
        state = payload.to
        let notice: (tone: NoticeItem.Tone, image: String, title: String)? =
            switch payload.to {
            case .failed: (.danger, "xmark.octagon", "The session failed")
            case .ended: (.neutral, "checkmark.circle", "The session ended")
            case .resumable: (.warning, "pause.circle", "The engine stopped; the session can be resumed")
            case .starting, .idle, .running, .awaitingApproval: nil
            }
        if let notice {
            appendTopLevel(.notice(NoticeItem(seq: seq, tone: notice.tone, systemImage: notice.image, title: notice.title)))
        }
    }

    private func assistant(_ messageId: Id, agent: String) -> AssistantMessageItem {
        if let existing = assistants[messageId] { return existing }
        let item = AssistantMessageItem(messageId: messageId, agent: agent, text: "", isStreaming: true)
        assistants[messageId] = item
        place(.assistant(item), parent: nil, agent: agent)
        return item
    }

    private func toolStarted(_ payload: ToolStartedPayload) {
        guard tools[payload.toolCallId] == nil else { return }
        let item = ToolCallItem(payload)
        tools[payload.toolCallId] = item
        place(.tool(item), parent: payload.parentToolCallId, agent: payload.agent)
    }

    private func tool(_ toolCallId: Id, name: String, agent: String, parent: Id?) -> ToolCallItem {
        if let existing = tools[toolCallId] { return existing }
        let item = ToolCallItem(toolCallId: toolCallId, toolName: name, agent: agent)
        tools[toolCallId] = item
        place(.tool(item), parent: parent, agent: agent)
        return item
    }

    private func subagentStarted(_ payload: SubagentStartedPayload) {
        let group = subagents[payload.toolCallId] ?? SubagentItem(payload)
        subagents[payload.toolCallId] = group
        runningSubagents[payload.agent] = group
        // Copilot starts a sub-agent through a `task` call; the group takes that call's row.
        if let index = topLevelIndex["tool.\(payload.toolCallId)"] {
            topLevelIndex["tool.\(payload.toolCallId)"] = nil
            topLevelIndex[group.id] = index
            entries[index] = .subagent(group)
        } else if topLevelIndex[group.id] == nil {
            appendTopLevel(.subagent(group))
        }
    }

    private func subagentCompleted(_ payload: SubagentCompletedPayload) {
        let group = subagent(payload.toolCallId, agent: payload.agent)
        group.model = payload.model
        group.requestedModel = payload.requestedModel
        group.status = .completed(totalTokens: payload.totalTokens, durationMs: payload.durationMs)
        runningSubagents[payload.agent] = nil
    }

    private func subagent(_ toolCallId: Id, agent: String) -> SubagentItem {
        if let existing = subagents[toolCallId] { return existing }
        let group = SubagentItem(SubagentStartedPayload(toolCallId: toolCallId, agent: agent, model: ""))
        subagents[toolCallId] = group
        appendTopLevel(.subagent(group))
        return group
    }

    private func policyDecided(_ seq: Seq, _ decision: PolicyDecision) {
        tools[decision.toolCallId]?.decision = decision
        guard decision.outcome != .allow else { return }
        place(.policy(PolicyItem(seq: seq, decision: decision)), parent: nil, agent: decision.agent)
    }

    private func approvalRequested(_ request: ApprovalRequest) {
        switch request.kind {
        case .toolCall:
            addApproval(request.id, kind: .toolCall(toolCallId: request.toolCallId), summary: request.summary)
        case .budget:
            addApproval(request.id, kind: .budget(spentCredits: 0, limitCredits: 0), summary: request.summary)
        }
    }

    /// `budget.exhausted` and its `approval.requested` name the same approval; the first one makes the row.
    private func addApproval(_ approvalId: Id, kind: ApprovalItem.Kind, summary: String) {
        guard approvals[approvalId] == nil else { return }
        let item = ApprovalItem(approvalId: approvalId, kind: kind, summary: summary)
        approvals[approvalId] = item
        appendTopLevel(.approval(item))
    }

    /// Rows a sub-agent produced go into its group: by the call they belong to, or else by the agent's name.
    private func place(_ entry: TimelineEntry, parent: Id?, agent: String) {
        if let group = parent.flatMap({ subagents[$0] }) ?? runningSubagents[agent] {
            group.children.append(entry)
        } else {
            appendTopLevel(entry)
        }
    }

    private func appendTopLevel(_ entry: TimelineEntry) {
        topLevelIndex[entry.id] = entries.count
        entries.append(entry)
    }

    private static func abortTitle(_ reason: SessionAbortedPayload.Reason) -> String {
        switch reason {
        case .user: "Stopped"
        case .budget: "Stopped: the budget ran out"
        case .engine: "Stopped: the engine stopped during the turn"
        }
    }
}

/// Events read off the main actor, waiting to be applied.
private final class EventBuffer: Sendable {
    private let state = Mutex<(events: [SessionEvent], failure: (any Error)?)>(([], nil))

    func append(_ event: SessionEvent) {
        state.withLock { $0.events.append(event) }
    }

    func fail(_ error: any Error) {
        state.withLock { $0.failure = error }
    }

    func drain() -> [SessionEvent] {
        state.withLock { state in
            defer { state.events.removeAll(keepingCapacity: true) }
            return state.events
        }
    }

    var failure: (any Error)? {
        state.withLock { $0.failure }
    }
}
