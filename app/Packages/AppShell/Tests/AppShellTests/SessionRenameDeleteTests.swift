@testable import AppShell
import EngineClient
import EngineClientTestSupport
import Foundation
import PicaProtocol
import Testing

/// Renaming and deleting sessions (docs/navigation-shell.md#renaming-and-deleting-sessions): where the selection goes,
/// and what a late notification may not undo.
@Suite @MainActor struct SessionDeletionSelectionTests {
    private func store(sessions: [(id: String, updatedAt: String)]) async -> NavigationStore {
        let store = NavigationStore(client: EngineClient(socketPath: "/nonexistent", secrets: InMemorySecretBroker()), stateFile: nil)
        await store.workspaceChanged(Workspace(id: "w", name: "W", sources: [], pinnedRepoIds: [], overrides: WorkspaceOverrides()))
        for (id, updatedAt) in sessions {
            store.sessionChanged(session(id, updatedAt: updatedAt))
        }
        return store
    }

    private func session(_ id: String, updatedAt: String = "2026-11-22T01:00:00Z", title: String? = nil) -> Session {
        Session(
            id: id, workspaceId: "w", title: title ?? id, state: .idle, writeRoots: [], referenceRoots: [],
            routingProfile: .off, budgetCredits: nil, lastSeq: 0, createdAt: "2026-11-22T00:00:00Z", updatedAt: updatedAt)
    }

    private let three = [("a", "2026-11-22T03:00:00Z"), ("b", "2026-11-22T02:00:00Z"), ("c", "2026-11-22T01:00:00Z")]

    @Test func deletingTheSelectedSessionSelectsTheNextOne() async {
        let store = await store(sessions: three)
        store.select(.session("b"))
        store.sessionDeleted("b")
        #expect(store.selection == .session("c"))
        #expect(store.sidebar.flatMap(\.sessions).map(\.id) == ["a", "c"])
    }

    @Test func deletingTheLastSessionSelectsThePreviousOneThenTheWorkspace() async {
        let store = await store(sessions: three)
        store.select(.session("c"))
        store.sessionDeleted("c")
        #expect(store.selection == .session("b"))
        store.sessionDeleted("a")
        store.sessionDeleted("b")
        #expect(store.selection == .workspace("w"))
    }

    @Test func deletingAnotherSessionKeepsTheSelectionAndRenumbers() async {
        let store = await store(sessions: three)
        store.select(.session("c"))
        store.sessionDeleted("a")
        #expect(store.selection == .session("c"))
        #expect(store.numberedSessions.map(\.id) == ["b", "c"])
        store.selectSession(offset: 1)
        #expect(store.selection == .session("b"))
    }

    @Test func aChangeAfterTheDeletionDoesNotBringTheSessionBack() async {
        let store = await store(sessions: three)
        store.sessionDeleted("a")
        store.sessionChanged(session("a", updatedAt: "2026-11-22T04:00:00Z"))
        #expect(store.sessionsById["a"] == nil)
    }

    @Test func aPendingActionOnADeletedSessionIsDropped() async {
        let store = await store(sessions: three)
        store.beginRename("a")
        #expect(store.pendingSessionAction == .rename("a"))
        store.sessionDeleted("a")
        #expect(store.pendingSessionAction == nil)
        store.beginDelete("missing")
        #expect(store.pendingSessionAction == nil)
    }

    @Test func theDeleteMessageNamesWhatIsLostAndAStoppedTurn() {
        let idle = SessionActionDialogs.deleteMessage(session("a"))
        #expect(idle.contains("timeline"))
        #expect(idle.contains("cannot be undone"))
        #expect(!idle.contains("stops it"))
        var running = session("a")
        running.state = .running
        #expect(SessionActionDialogs.deleteMessage(running).contains("stops it first"))
    }
}

/// Against a real `picad` with a FakeRuntime: rename and delete reach this store and every other client.
@Suite(.serialized, .timeLimit(.minutes(1))) @MainActor struct SessionRenameDeleteEngineTests {
    @Test func renameAndDeleteReachTheSidebar() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        let supervisor = try fixture.supervisor()
        let store = NavigationStore(client: supervisor.client, stateFile: nil)
        store.start()
        await supervisor.start()
        defer { store.stop() }
        await eventually { store.hasLoaded }

        // Another client makes the sessions and watches the deletion.
        let other = EngineClient(socketPath: fixture.socketPath, secrets: InMemorySecretBroker())
        try await other.connect()
        let deletions = await other.notifications(Notifications.SessionDeleted.self)
        let workspace = try await other.request(Methods.WorkspaceCreate.self, WorkspaceCreateParams(name: "Atlas")).workspace
        let repo = try await other.request(
            Methods.RepoAddPath.self, RepoAddPathParams(path: try fixture.makeRepository("atlas").path)).repo
        var ids: [Id] = []
        for _ in 0..<2 {
            ids.append(try await other.request(
                Methods.SessionCreate.self,
                SessionCreateParams(workspaceId: workspace.id, writeRepoIds: [repo.id], referenceRepoIds: [], prompt: nil)
            ).session.id)
        }
        await eventually { ids.allSatisfy { store.sessionsById[$0] != nil } }

        await store.rename(ids[0], to: "  Fix the login bug ")
        #expect(store.sessionsById[ids[0]]?.displayTitle == "Fix the login bug")
        await store.rename(ids[0], to: "")
        #expect(store.sessionsById[ids[0]]?.displayTitle == "Untitled session")
        #expect(store.sessionActionFailure == nil)

        store.select(.session(ids[0]))
        await store.delete(ids[0])
        #expect(store.sessionsById[ids[0]] == nil)
        #expect(store.selection == .session(ids[1]))
        var received = deletions.makeAsyncIterator()
        #expect(await received.next()?.sessionId == ids[0])

        // A reload after the deletion does not bring it back.
        await store.reload()
        #expect(store.sessionsById[ids[0]] == nil)
        #expect(store.sessionsById[ids[1]] != nil)

        await store.delete(ids[0])
        #expect(store.sessionActionFailure?.contains("could not be deleted") == true)
        await other.close()
        await supervisor.stop()
    }
}
