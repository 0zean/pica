@testable import AppShell
import EngineClient
import EngineClientTestSupport
import Foundation
import Observation
import PicaProtocol
import Testing

/// A-04's store against a real `picad` with a FakeRuntime: what the engine creates reaches the sidebar.
@Suite(.serialized, .timeLimit(.minutes(1))) @MainActor struct NavigationStoreEngineTests {
    @Test func aWorkspaceCreatedThroughTheEngineAppearsInTheSidebar() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        let supervisor = try fixture.supervisor()
        let store = NavigationStore(client: supervisor.client, stateFile: nil)
        store.start()
        await supervisor.start()
        defer { store.stop() }
        await eventually { store.hasLoaded }
        #expect(store.sidebar.isEmpty)

        let other = EngineClient(socketPath: fixture.socketPath, secrets: InMemorySecretBroker())
        try await other.connect()
        let created = try await other.request(Methods.WorkspaceCreate.self, WorkspaceCreateParams(name: "Atlas")).workspace
        await eventually { store.sidebar.map(\.workspace.name) == ["Atlas"] }
        #expect(store.contains(.workspace(created.id)))
        await other.close()
        await supervisor.stop()
    }

    @Test func aReloadThatStartedBeforeANotificationDoesNotUndoIt() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        let supervisor = try fixture.supervisor()
        let store = NavigationStore(client: supervisor.client, stateFile: nil)
        store.start()
        await supervisor.start()
        defer { store.stop() }
        await eventually { store.hasLoaded }
        let workspace = Workspace(id: "late", name: "Late", sources: [], pinnedRepoIds: [], overrides: WorkspaceOverrides())
        // The reload runs up to its first request, then the notification arrives while it waits for the engine.
        let reloading = Task { await store.reload() }
        await Task.yield()
        await store.workspaceChanged(workspace)
        await reloading.value
        #expect(store.workspace("late") != nil)
        await supervisor.stop()
    }
}

@Suite struct SessionOrderingTests {
    private func session(_ id: String, _ state: SessionState, updatedAt: String) -> Session {
        Session(
            id: id, workspaceId: "w", title: id, state: state, writeRoots: [], referenceRoots: [], routingProfile: .off,
            budgetCredits: nil, lastSeq: 0, createdAt: "2026-11-16T00:00:00Z", updatedAt: updatedAt)
    }

    @Test func sessionsNeedingAttentionSortToTheTopThenMostRecentFirst() {
        let sorted = SessionOrdering.sorted([
            session("old-idle", .idle, updatedAt: "2026-11-16T01:00:00Z"),
            session("new-running", .running, updatedAt: "2026-11-16T05:00:00Z"),
            session("old-approval", .awaitingApproval, updatedAt: "2026-11-16T00:30:00Z"),
            session("failed", .failed, updatedAt: "2026-11-16T02:00:00Z"),
            session("ended", .ended, updatedAt: "2026-11-16T03:00:00Z"),
        ])
        #expect(sorted.map(\.id) == ["failed", "old-approval", "new-running", "ended", "old-idle"])
    }

    @Test(arguments: SessionState.allCases)
    func onlyApprovalsAndFailuresNeedAttention(_ state: SessionState) {
        #expect(state.needsAttention == (state == .awaitingApproval || state == .failed))
    }
}

@Suite @MainActor struct WindowStateTests {
    @Test func theWindowStateRoundTripsThroughItsFile() throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "pica-a04-\(UUID().uuidString)/window-state.json")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let file = WindowStateFile(url: url)
        let client = EngineClient(socketPath: "/nonexistent", secrets: InMemorySecretBroker())

        let first = NavigationStore(client: client, stateFile: file)
        first.selection = .repo(workspaceId: "w", repoId: "r")
        first.inspectorWidth = 333
        first.isInspectorPresented = true
        first.setExpanded(false, workspaceId: "w")
        first.saveNow()

        let second = NavigationStore(client: client, stateFile: file)
        #expect(second.selection == .repo(workspaceId: "w", repoId: "r"))
        #expect(second.restoredInspectorWidth == 333)
        #expect(second.isInspectorPresented)
        #expect(!second.isExpanded("w"))
    }

    @Test func aMissingOrUnreadableFileGivesAFreshState() throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "pica-a04-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(WindowStateFile(url: url).load() == WindowState())
        try Data("not json".utf8).write(to: url)
        #expect(WindowStateFile(url: url).load() == WindowState())
    }

    @Test func repoNamesComeFromTheRemoteOrThePath() {
        func repo(_ remote: String?, _ path: String?) -> Repo {
            Repo(id: "id", remoteUrl: remote, localPath: path, managed: false, defaultBranch: nil, cloneState: .cloned)
        }
        #expect(repo("https://git.example.com/acme/atlas.git", nil).displayName == "atlas")
        #expect(repo("git@git.example.com:acme/borealis", "/x/y").displayName == "borealis")
        #expect(repo(nil, "/Users/me/src/cirrus").displayName == "cirrus")
    }
}

/// Returns once `condition` holds, re-checking it whenever something it reads in an `@Observable` store changes.
/// The suites' time limit ends a wait that never succeeds.
@MainActor
func eventually(_ condition: @escaping @MainActor () -> Bool) async {
    while !condition() {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            withObservationTracking {
                _ = condition()
            } onChange: {
                continuation.resume()
            }
        }
    }
}
