import EngineClient
import Foundation
import Observation
import PicaProtocol

/// The inspector's MCP pane for one session: which of its workspace's servers the session has, and what they add to
/// each prompt. A live session's tool set is fixed when its runtime starts (PLAN.md §5.5), so a change there is held
/// as `pendingChange` until the user accepts the cost of a cold prompt cache.
@MainActor
@Observable
public final class SessionMcpStore {
    public struct PendingChange: Equatable, Sendable {
        public let serverId: Id
        public let serverName: String
        public let attach: Bool
        /// The tool-definition tokens the change adds or removes; nil while the server's tools are unknown.
        public let toolDefinitionTokens: Count?
    }

    public private(set) var servers: [McpServerDef] = []
    public private(set) var attached: Set<Id> = []
    public private(set) var statuses: [Id: McpServerStatus] = [:]
    /// What the attached servers add to each prompt; nil while a tool list is unknown.
    public private(set) var toolDefinitionTokens: Count?
    public var pendingChange: PendingChange?
    public var message: String?

    @ObservationIgnored private let backend: any McpBackend
    @ObservationIgnored private var session: Session?

    public init(backend: any McpBackend) {
        self.backend = backend
    }

    public func load(session: Session) async {
        self.session = session
        do {
            servers = try await backend.servers(workspaceId: session.workspaceId)
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            statuses = Dictionary(try await backend.statuses().map { ($0.serverId, $0) }, uniquingKeysWith: { $1 })
            await refreshAttachments()
            message = nil
        } catch {
            message = McpErrorText.describe(error)
        }
    }

    /// Keeps the session's state current between loads, so a change is asked about whenever the session is live.
    public func follow(_ session: Session) {
        self.session = session
    }

    public func watchStatuses() async {
        for await status in await backend.statusChanges() {
            statuses[status.serverId] = status
        }
    }

    /// Asks first when the session is live; otherwise changes it at once.
    public func toggle(_ server: McpServerDef) async {
        guard let session else { return }
        let attach = !attached.contains(server.id)
        if session.state.isLive {
            pendingChange = PendingChange(
                serverId: server.id, serverName: server.name, attach: attach,
                toolDefinitionTokens: statuses[server.id]?.toolDefinitionTokens)
            return
        }
        await apply(serverId: server.id, attach: attach, acknowledged: false)
    }

    /// The user accepted the cache reset for `change`. It is passed in because the alert clears `pendingChange` as it
    /// closes, which can happen before its button's action runs.
    public func confirm(_ change: PendingChange) async {
        pendingChange = nil
        await apply(serverId: change.serverId, attach: change.attach, acknowledged: true)
    }

    public func cancelPendingChange() {
        pendingChange = nil
    }

    private func apply(serverId: Id, attach: Bool, acknowledged: Bool) async {
        guard let session else { return }
        do {
            if attach {
                _ = try await backend.attach(serverId, to: .session(session.id), acknowledgeCacheReset: acknowledged)
            } else {
                try await backend.detach(serverId, from: .session(session.id), acknowledgeCacheReset: acknowledged)
            }
            message = nil
        } catch let error as EngineClientError where error.code == .cacheResetUnconfirmed {
            // The session went live after this pane last saw it; ask now.
            let name = servers.first { $0.id == serverId }?.name ?? serverId
            pendingChange = PendingChange(
                serverId: serverId, serverName: name, attach: attach, toolDefinitionTokens: statuses[serverId]?.toolDefinitionTokens)
        } catch {
            message = McpErrorText.describe(error)
        }
        await refreshAttachments()
    }

    private func refreshAttachments() async {
        guard let session else { return }
        do {
            let result = try await backend.attachments(.session(session.id))
            attached = Set(result.attachments.filter { $0.agent == nil }.map(\.serverId))
            toolDefinitionTokens = result.toolDefinitionTokens
        } catch {
            message = McpErrorText.describe(error)
        }
    }
}

extension SessionState {
    /// A session whose runtime is open; changing its servers reopens it.
    var isLive: Bool {
        switch self {
        case .starting, .idle, .running, .awaitingApproval: true
        case .ended, .failed, .resumable: false
        }
    }
}
