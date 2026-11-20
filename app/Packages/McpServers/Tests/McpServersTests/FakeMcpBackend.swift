import EngineClient
import Foundation
@testable import McpServers
import PicaProtocol
import Synchronization

/// Records every call and answers from what the test set up.
final class FakeMcpBackend: McpBackend {
    struct State {
        var servers: [McpServerDef] = []
        var statuses: [McpServerStatus] = []
        var presets: [McpPreset] = []
        var attachments: [McpAttachTarget: [McpAttachment]] = [:]
        var calls: [String] = []
        var storedSecrets: [String: String] = [:]
        var rendered: [String: String]?
        /// When set, the next attach or detach fails with `cache_reset_unconfirmed` unless acknowledged.
        var requiresAcknowledgement = false
    }

    let state = Mutex(State())

    var calls: [String] { state.withLock { $0.calls } }

    private func record(_ call: String) {
        state.withLock { $0.calls.append(call) }
    }

    func presets() async throws -> [McpPreset] { state.withLock { $0.presets } }

    func renderPreset(_ presetId: Id, parameters: [String: String], serverId: Id?, scope: McpScope) async throws -> McpServerDef {
        record("renderPreset \(presetId)")
        state.withLock { $0.rendered = parameters }
        return McpServerDef(
            id: serverId ?? presetId, name: presetId,
            transport: .http(.init(type: .http, url: "https://example.test/mcp", headers: [:])), toolAllowlist: nil, scope: scope)
    }

    func servers(workspaceId: Id?) async throws -> [McpServerDef] { state.withLock { $0.servers } }

    func add(_ server: McpServerDef, workspaceId: Id?) async throws -> McpServerDef {
        record("add \(server.id)")
        state.withLock { $0.servers.append(server) }
        return server
    }

    func update(_ server: McpServerDef, workspaceId: Id?) async throws -> McpServerDef {
        record("update \(server.id)")
        state.withLock { state in state.servers = state.servers.map { $0.id == server.id ? server : $0 } }
        return server
    }

    func remove(_ serverId: Id, workspaceId: Id?) async throws { record("remove \(serverId)") }
    func statuses() async throws -> [McpServerStatus] { state.withLock { $0.statuses } }
    func statusChanges() async -> AsyncStream<McpServerStatus> { AsyncStream { $0.finish() } }
    func restart(_ serverId: Id) async throws { record("restart \(serverId)") }
    func login(_ serverId: Id) async throws { record("login \(serverId)") }

    func attachments(_ target: McpAttachTarget) async throws -> McpAttachmentsResult {
        McpAttachmentsResult(attachments: state.withLock { $0.attachments[target] ?? [] }, toolDefinitionTokens: 120)
    }

    func attach(_ serverId: Id, to target: McpAttachTarget, acknowledgeCacheReset: Bool) async throws -> Count? {
        record("attach \(serverId) ack=\(acknowledgeCacheReset)")
        try refuseUnacknowledged(acknowledgeCacheReset)
        state.withLock { $0.attachments[target, default: []].append(McpAttachment(serverId: serverId, agent: nil)) }
        return 120
    }

    func detach(_ serverId: Id, from target: McpAttachTarget, acknowledgeCacheReset: Bool) async throws {
        record("detach \(serverId) ack=\(acknowledgeCacheReset)")
        try refuseUnacknowledged(acknowledgeCacheReset)
        state.withLock { $0.attachments[target]?.removeAll { $0.serverId == serverId } }
    }

    func importCandidates(snippet: McpImportSnippet?) async throws -> [McpImportSource] { [] }

    func importServers(scope: McpScope, workspaceId: Id?, candidates: [McpImportSelection]?, snippet: McpImportSnippet?)
        async throws -> McpImportResult
    {
        record("import")
        return McpImportResult(servers: [], file: "/tmp/mcp.jsonc", secretRefs: [], notes: [])
    }

    func storeSecret(_ value: String, ref: String) async throws {
        record("storeSecret \(ref)")
        state.withLock { $0.storedSecrets[ref] = value }
    }

    private func refuseUnacknowledged(_ acknowledged: Bool) throws {
        guard state.withLock({ $0.requiresAcknowledgement }), !acknowledged else { return }
        throw EngineClientError.engine(
            RpcError(code: -32000, message: "confirm the cache reset", data: ErrorData(code: .cacheResetUnconfirmed)))
    }
}
