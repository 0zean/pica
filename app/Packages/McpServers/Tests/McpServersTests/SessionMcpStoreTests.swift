@testable import McpServers
import PicaProtocol
import Testing

/// A-13: changing servers on a live session shows the cache-invalidation warning before anything changes.
@MainActor
struct SessionMcpStoreTests {
    private let github = McpServerDef(
        id: "github", name: "GitHub", transport: .http(.init(type: .http, url: "https://example.test/mcp", headers: [:])),
        toolAllowlist: nil, scope: .global)

    private func session(_ state: SessionState) -> Session {
        Session(
            id: "s1", workspaceId: "w1", title: "Fix the build", state: state, writeRoots: [], referenceRoots: [],
            routingProfile: .off, budgetCredits: nil, lastSeq: 0, createdAt: "2026-11-20T10:00:00Z", updatedAt: "2026-11-20T10:00:00Z")
    }

    private func store(_ state: SessionState) async -> (SessionMcpStore, FakeMcpBackend) {
        let backend = FakeMcpBackend()
        backend.state.withLock {
            $0.servers = [github]
            $0.statuses = [McpServerStatus(serverId: "github", state: .healthy, lastError: nil, tools: ["search"], latencyMs: 3, toolDefinitionTokens: 640, checkedAt: nil, restarts: 0)]
        }
        let store = SessionMcpStore(backend: backend)
        await store.load(session: session(state))
        return (store, backend)
    }

    @Test(arguments: [SessionState.idle, .running, .awaitingApproval, .starting])
    func aLiveSessionAsksFirstAndChangesNothingUntilConfirmed(state: SessionState) async throws {
        let (store, backend) = await store(state)
        await store.toggle(github)
        #expect(store.pendingChange == .init(serverId: "github", serverName: "GitHub", attach: true, toolDefinitionTokens: 640))
        #expect(backend.calls.isEmpty)
        let change = try #require(store.pendingChange)
        #expect(SessionMcpPane.warning(for: change).contains("640 tool-definition tokens"))
        // The alert clears the pending change as it closes, before its button's action runs.
        store.cancelPendingChange()
        await store.confirm(change)
        #expect(backend.calls == ["attach github ack=true"])
        #expect(store.attached == ["github"])
    }

    @Test func cancellingLeavesTheSessionAsItWas() async {
        let (store, backend) = await store(.idle)
        await store.toggle(github)
        store.cancelPendingChange()
        #expect(store.pendingChange == nil)
        #expect(backend.calls.isEmpty)
        #expect(store.attached.isEmpty)
    }

    @Test func anEndedSessionChangesWithoutAsking() async {
        let (store, backend) = await store(.ended)
        await store.toggle(github)
        #expect(store.pendingChange == nil)
        #expect(backend.calls == ["attach github ack=false"])
    }

    @Test func anEngineRefusalStillAsks() async {
        let (store, backend) = await store(.resumable)
        backend.state.withLock { $0.requiresAcknowledgement = true }
        await store.toggle(github)
        #expect(store.pendingChange?.serverId == "github")
        #expect(store.attached.isEmpty)
    }
}
