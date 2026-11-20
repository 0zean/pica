import EngineClient
import Foundation
import Observation
import PicaProtocol

/// The MCP Servers window (docs/mcp.md): the servers defined globally and in the chosen workspace, with their health
/// and tool-definition cost, the optional presets, and which servers the workspace attaches to new sessions.
@MainActor
@Observable
public final class McpServersStore {
    /// nil shows global servers only.
    public private(set) var workspaceId: Id?
    public private(set) var servers: [McpServerDef] = []
    public private(set) var statuses: [Id: McpServerStatus] = [:]
    public private(set) var presets: [McpPreset] = []
    /// Servers the chosen workspace attaches to each new session.
    public private(set) var workspaceAttached: Set<Id> = []
    /// The last failure, shown above the list until the next action.
    public var message: String?
    public private(set) var isLoading = false

    @ObservationIgnored private let backend: any McpBackend

    public init(backend: any McpBackend) {
        self.backend = backend
    }

    public func load(workspaceId: Id?) async {
        self.workspaceId = workspaceId
        isLoading = true
        defer { isLoading = false }
        await report {
            if presets.isEmpty { presets = try await backend.presets() }
            servers = try await backend.servers(workspaceId: workspaceId).sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            statuses = Dictionary(try await backend.statuses().map { ($0.serverId, $0) }, uniquingKeysWith: { $1 })
            if let workspaceId {
                workspaceAttached = Set(try await backend.attachments(.workspace(workspaceId)).attachments.map(\.serverId))
            } else {
                workspaceAttached = []
            }
        }
    }

    /// Follows `mcp.statusChanged` until the task is cancelled.
    public func watchStatuses() async {
        for await status in await backend.statusChanges() {
            statuses[status.serverId] = status
        }
    }

    /// The scope a new server gets: the workspace's own when one is chosen.
    public var newServerScope: McpScope { workspaceId == nil ? .global : .workspace }

    /// Stores typed secrets, then writes the server. Returns false when the engine refused it.
    public func save(_ draft: ServerDraft) async -> Bool {
        await report {
            for secret in draft.enteredSecrets {
                try await backend.storeSecret(secret.value, ref: secret.ref)
            }
            if draft.isEditing {
                _ = try await backend.update(draft.definition, workspaceId: workspaceIdFor(draft.scope))
                // A replaced secret is read on the next check, not the one already running.
                if !draft.enteredSecrets.isEmpty { try await backend.restart(draft.id) }
            } else {
                _ = try await backend.add(draft.definition, workspaceId: workspaceIdFor(draft.scope))
            }
            await refreshServers()
        }
    }

    public func addPreset(_ form: PresetForm) async -> Bool {
        await report {
            for secret in form.enteredSecrets {
                try await backend.storeSecret(secret.value, ref: secret.ref)
            }
            let server = try await backend.renderPreset(
                form.preset.id, parameters: form.renderParameters, serverId: form.serverId, scope: form.scope)
            _ = try await backend.add(server, workspaceId: workspaceIdFor(form.scope))
            await refreshServers()
        }
    }

    public func remove(_ server: McpServerDef) async {
        await report {
            try await backend.remove(server.id, workspaceId: workspaceIdFor(server.scope))
            await refreshServers()
        }
    }

    public func restart(_ serverId: Id) async {
        await report { try await backend.restart(serverId) }
    }

    public func signIn(_ serverId: Id) async {
        await report { try await backend.login(serverId) }
    }

    /// Attaching to a workspace changes only sessions created after it, so no running session's cache is touched.
    public func setAttached(_ serverId: Id, _ attached: Bool) async {
        guard let workspaceId else { return }
        await report {
            if attached {
                _ = try await backend.attach(serverId, to: .workspace(workspaceId), acknowledgeCacheReset: false)
                workspaceAttached.insert(serverId)
            } else {
                try await backend.detach(serverId, from: .workspace(workspaceId), acknowledgeCacheReset: false)
                workspaceAttached.remove(serverId)
            }
        }
    }

    /// Whether a remote server may offer browser sign-in: one with no Authorization header of its own.
    public func offersSignIn(_ server: McpServerDef) -> Bool {
        guard case .http(let http) = server.transport else { return false }
        return !http.headers.keys.contains { $0.lowercased() == "authorization" }
    }

    private func refreshServers() async {
        await load(workspaceId: workspaceId)
    }

    private func workspaceIdFor(_ scope: McpScope) -> Id? {
        scope == .workspace ? workspaceId : nil
    }

    /// Runs `body`, keeping its failure as `message`. Returns whether it succeeded.
    @discardableResult
    private func report(_ body: () async throws -> Void) async -> Bool {
        do {
            try await body()
            message = nil
            return true
        } catch {
            message = McpErrorText.describe(error)
            return false
        }
    }
}

/// The text shown for a failed engine call: the engine's own message, which names what to fix.
enum McpErrorText {
    static func describe(_ error: any Error) -> String {
        if case .engine(let rpc) = error as? EngineClientError { return rpc.message }
        return error.localizedDescription
    }
}
