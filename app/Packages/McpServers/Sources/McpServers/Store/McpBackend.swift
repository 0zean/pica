import EngineClient
import Foundation
import PicaProtocol

/// Where a server is attached: a workspace (copied into each new session there) or one session.
public enum McpAttachTarget: Hashable, Sendable {
    case workspace(Id)
    case session(Id)
}

/// The engine calls MCP management makes (docs/mcp.md), and the one secret write the app does itself.
/// `EngineMcpBackend` makes them over `EngineClient`; tests use a fake.
public protocol McpBackend: Sendable {
    func presets() async throws -> [McpPreset]
    func renderPreset(_ presetId: Id, parameters: [String: String], serverId: Id?, scope: McpScope) async throws -> McpServerDef
    func servers(workspaceId: Id?) async throws -> [McpServerDef]
    func add(_ server: McpServerDef, workspaceId: Id?) async throws -> McpServerDef
    func update(_ server: McpServerDef, workspaceId: Id?) async throws -> McpServerDef
    func remove(_ serverId: Id, workspaceId: Id?) async throws
    func statuses() async throws -> [McpServerStatus]
    func statusChanges() async -> AsyncStream<McpServerStatus>
    func restart(_ serverId: Id) async throws
    func login(_ serverId: Id) async throws
    func attachments(_ target: McpAttachTarget) async throws -> McpAttachmentsResult
    func attach(_ serverId: Id, to target: McpAttachTarget, acknowledgeCacheReset: Bool) async throws -> Count?
    func detach(_ serverId: Id, from target: McpAttachTarget, acknowledgeCacheReset: Bool) async throws
    func importCandidates(snippet: McpImportSnippet?) async throws -> [McpImportSource]
    func importServers(scope: McpScope, workspaceId: Id?, candidates: [McpImportSelection]?, snippet: McpImportSnippet?)
        async throws -> McpImportResult
    /// Writes a secret the user typed to the Keychain broker under `ref` (`keychain:<name>`). Secrets are never read
    /// back into the UI.
    func storeSecret(_ value: String, ref: String) async throws
}

public struct EngineMcpBackend: McpBackend {
    private let client: EngineClient
    private let secrets: any SecretBroker
    /// Signing in waits for the user in the browser.
    private static let loginTimeout: Duration = .seconds(300)

    public init(client: EngineClient, secrets: any SecretBroker) {
        self.client = client
        self.secrets = secrets
    }

    public func presets() async throws -> [McpPreset] {
        try await client.request(Methods.McpPresets.self).presets
    }

    public func renderPreset(_ presetId: Id, parameters: [String: String], serverId: Id?, scope: McpScope) async throws
        -> McpServerDef
    {
        try await client.request(
            Methods.McpRenderPreset.self,
            McpRenderPresetParams(presetId: presetId, parameters: parameters, serverId: serverId, scope: scope)
        ).server
    }

    public func servers(workspaceId: Id?) async throws -> [McpServerDef] {
        try await client.request(Methods.McpList.self, McpListParams(workspaceId: workspaceId)).servers
    }

    public func add(_ server: McpServerDef, workspaceId: Id?) async throws -> McpServerDef {
        try await client.request(Methods.McpAdd.self, McpAddParams(server: server, workspaceId: workspaceId)).server
    }

    public func update(_ server: McpServerDef, workspaceId: Id?) async throws -> McpServerDef {
        try await client.request(Methods.McpUpdate.self, McpUpdateParams(server: server, workspaceId: workspaceId)).server
    }

    public func remove(_ serverId: Id, workspaceId: Id?) async throws {
        _ = try await client.request(Methods.McpRemove.self, McpRemoveParams(id: serverId, workspaceId: workspaceId))
    }

    public func statuses() async throws -> [McpServerStatus] {
        try await client.request(Methods.McpStatusList.self).statuses
    }

    public func statusChanges() async -> AsyncStream<McpServerStatus> {
        let changes = await client.notifications(Notifications.McpStatusChanged.self)
        return AsyncStream { continuation in
            let task = Task {
                for await change in changes { continuation.yield(change.status) }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func restart(_ serverId: Id) async throws {
        _ = try await client.request(Methods.McpRestart.self, ById(id: serverId))
    }

    public func login(_ serverId: Id) async throws {
        _ = try await client.request(Methods.McpLogin.self, ById(id: serverId), timeout: Self.loginTimeout)
    }

    public func attachments(_ target: McpAttachTarget) async throws -> McpAttachmentsResult {
        let (sessionId, workspaceId) = target.ids
        return try await client.request(
            Methods.McpAttachments.self, McpAttachmentsParams(sessionId: sessionId, workspaceId: workspaceId))
    }

    public func attach(_ serverId: Id, to target: McpAttachTarget, acknowledgeCacheReset: Bool) async throws -> Count? {
        let (sessionId, workspaceId) = target.ids
        return try await client.request(
            Methods.McpAttach.self,
            McpAttachParams(
                serverId: serverId, sessionId: sessionId, workspaceId: workspaceId,
                acknowledgeCacheReset: acknowledgeCacheReset)
        ).toolDefinitionTokens
    }

    public func detach(_ serverId: Id, from target: McpAttachTarget, acknowledgeCacheReset: Bool) async throws {
        let (sessionId, workspaceId) = target.ids
        _ = try await client.request(
            Methods.McpDetach.self,
            McpDetachParams(
                serverId: serverId, sessionId: sessionId, workspaceId: workspaceId,
                acknowledgeCacheReset: acknowledgeCacheReset))
    }

    public func importCandidates(snippet: McpImportSnippet?) async throws -> [McpImportSource] {
        try await client.request(Methods.McpImportCandidates.self, McpImportCandidatesParams(snippet: snippet)).sources
    }

    public func importServers(
        scope: McpScope, workspaceId: Id?, candidates: [McpImportSelection]?, snippet: McpImportSnippet?
    ) async throws -> McpImportResult {
        try await client.request(
            Methods.McpImport.self,
            McpImportParams(scope: scope, workspaceId: workspaceId, candidates: candidates, snippet: snippet))
    }

    public func storeSecret(_ value: String, ref: String) async throws {
        try await secrets.store(value, for: ref)
    }
}

extension McpAttachTarget {
    var ids: (session: Id?, workspace: Id?) {
        switch self {
        case .workspace(let id): (nil, id)
        case .session(let id): (id, nil)
        }
    }
}
