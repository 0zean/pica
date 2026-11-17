import Foundation
import Observation
import PicaProtocol

/// One row of the timeline. Each case holds an observable item, so a streaming delta or a tool's result changes only
/// that row and not the list of rows.
public enum TimelineEntry: Identifiable {
    case user(UserMessageItem)
    case assistant(AssistantMessageItem)
    case tool(ToolCallItem)
    case subagent(SubagentItem)
    case policy(PolicyItem)
    case approval(ApprovalItem)
    case notice(NoticeItem)

    public var id: String {
        switch self {
        case .user(let item): item.id
        case .assistant(let item): item.id
        case .tool(let item): item.id
        case .subagent(let item): item.id
        case .policy(let item): item.id
        case .approval(let item): item.id
        case .notice(let item): item.id
        }
    }
}

@Observable @MainActor
public final class UserMessageItem {
    public let id: String
    public let text: String
    public let mode: UserMessagePayload.Mode

    init(seq: Seq, text: String, mode: UserMessagePayload.Mode) {
        id = "user.\(seq)"
        self.text = text
        self.mode = mode
    }
}

@Observable @MainActor
public final class AssistantMessageItem {
    public let id: String
    public let agent: String
    public private(set) var text: String
    /// True until `assistant.message` replaces the deltas with the whole text.
    public private(set) var isStreaming: Bool
    @ObservationIgnored private var parsed: (text: String, document: MarkdownDocument)?

    init(messageId: Id, agent: String, text: String, isStreaming: Bool) {
        id = "assistant.\(messageId)"
        self.agent = agent
        self.text = text
        self.isStreaming = isStreaming
    }

    func append(_ delta: String) {
        text += delta
    }

    func finish(_ whole: String) {
        text = whole
        isStreaming = false
    }

    /// Parsed on first use and again only after the text changed, so rows scrolled past are never parsed.
    public var document: MarkdownDocument {
        if let parsed, parsed.text == text { return parsed.document }
        let document = MarkdownDocument(parsing: text)
        parsed = (text, document)
        return document
    }
}

@Observable @MainActor
public final class ToolCallItem {
    public enum Status: Equatable {
        case running
        case completed(preview: String, bytes: Count, spilledPath: String?)
        case failed(error: String)
    }

    public let id: String
    public let toolCallId: Id
    public let toolName: String
    public let agent: String
    public let arguments: [String: JSONValue]
    public internal(set) var status = Status.running
    /// The policy decision that let the call run, or stopped it.
    public internal(set) var decision: PolicyDecision?
    public var isExpanded = false

    init(_ payload: ToolStartedPayload) {
        id = "tool.\(payload.toolCallId)"
        toolCallId = payload.toolCallId
        toolName = payload.toolName
        agent = payload.agent
        arguments = payload.arguments
    }

    /// A call the timeline learns about from its result, when its start was not in the log.
    init(toolCallId: Id, toolName: String, agent: String) {
        id = "tool.\(toolCallId)"
        self.toolCallId = toolCallId
        self.toolName = toolName
        self.agent = agent
        arguments = [:]
    }
}

/// A sub-agent's run, collapsed to its name, model, duration and tokens, with the rows it produced inside.
@Observable @MainActor
public final class SubagentItem {
    public enum Status: Equatable {
        case running
        case completed(totalTokens: Count, durationMs: Count)
        case failed(error: String)
    }

    public let id: String
    public let toolCallId: Id
    public let agent: String
    public internal(set) var model: Id
    /// Set when the runtime ran another model than the one requested (S-03).
    public internal(set) var requestedModel: Id?
    public internal(set) var status = Status.running
    public internal(set) var children: [TimelineEntry] = []
    public var isExpanded = false

    init(_ payload: SubagentStartedPayload) {
        id = "subagent.\(payload.toolCallId)"
        toolCallId = payload.toolCallId
        agent = payload.agent
        model = payload.model
    }
}

/// A policy decision that did not simply allow a call: a deny, an ask or a rewrite.
@Observable @MainActor
public final class PolicyItem {
    public let id: String
    public let decision: PolicyDecision

    init(seq: Seq, decision: PolicyDecision) {
        id = "policy.\(seq)"
        self.decision = decision
    }
}

/// A request for the user's approval, of a tool call or of more budget, and what the user chose.
@Observable @MainActor
public final class ApprovalItem {
    public enum Kind: Equatable {
        case toolCall(toolCallId: Id?)
        case budget(spentCredits: Credits, limitCredits: Credits)
    }

    public let id: String
    public let approvalId: Id
    public let kind: Kind
    public let summary: String
    /// The tool the request is for and its command, path or url, when its call is in the timeline (A-07).
    public let toolName: String?
    public let subject: String?
    public internal(set) var choice: ApprovalChoice?
    /// True from a click on a choice until the engine reports the resolution, or the request fails.
    public internal(set) var isResolving = false
    /// Why the last choice was not accepted; the request is still pending.
    public internal(set) var failure: String?

    init(approvalId: Id, kind: Kind, summary: String, toolName: String? = nil, subject: String? = nil) {
        id = "approval.\(approvalId)"
        self.approvalId = approvalId
        self.kind = kind
        self.summary = summary
        self.toolName = toolName
        self.subject = subject
    }

    /// Sends `choice` through `action`. The row shows the choice once `approval.resolved` arrives.
    public func resolve(_ choice: ApprovalChoice, with action: ResolveApprovalAction) async {
        guard self.choice == nil, !isResolving else { return }
        isResolving = true
        failure = nil
        do {
            try await action(approvalId: approvalId, choice: choice)
        } catch {
            isResolving = false
            failure = ResolveApprovalAction.describe(error)
        }
    }
}

/// A one-line account of something that happened to the session: it stopped, failed, ran low on budget, or the
/// engine reported an event the app does not know.
@Observable @MainActor
public final class NoticeItem {
    public enum Tone: Equatable {
        case neutral
        case warning
        case danger
    }

    public let id: String
    public let tone: Tone
    public let systemImage: String
    public let title: String
    /// A short line under the title, such as an error's code.
    public let caption: String?
    /// The raw event, shown when the row is expanded, for events the app cannot draw.
    public let raw: String?
    public var isExpanded = false

    init(seq: Seq, tone: Tone, systemImage: String, title: String, caption: String? = nil, raw: String? = nil) {
        id = "notice.\(seq)"
        self.tone = tone
        self.systemImage = systemImage
        self.title = title
        self.caption = caption
        self.raw = raw
    }
}

/// What the header chip shows: context use, tokens and credits for the session.
public struct SessionUsageSummary: Equatable, Sendable {
    public var inputTokens = 0
    public var cachedInputTokens = 0
    public var outputTokens = 0
    public var credits: Credits = 0
    public var contextTokens: Count?
    public var contextLimit: Count?

    public init() {}

    public var totalTokens: Int { inputTokens + outputTokens }

    /// Context use from 0 to 1, when the runtime has reported it.
    public var contextFraction: Double? {
        guard let contextTokens, let contextLimit, contextLimit > 0 else { return nil }
        return min(Double(contextTokens) / Double(contextLimit), 1)
    }
}
