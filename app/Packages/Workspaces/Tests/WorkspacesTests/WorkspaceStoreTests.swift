@testable import Workspaces
import Foundation
import PicaProtocol
import Testing

@MainActor
@Suite struct WorkspaceStoreTests {
    let backend = FakeWorkspacesBackend()

    @Test func aPathIsRegisteredInPlaceAndAURLIsClonedThenEachIsPinned() async {
        let store = WorkspaceStore(workspaceId: "w1", backend: backend)
        #expect(await store.addRepo("  /work/atlas/ "))
        #expect(await store.addRepo("https://git.example.com/acme/beacon"))
        #expect(backend.calls == [
            "addPath /work/atlas", "pin added-1 w1",
            "addUrl https://git.example.com/acme/beacon", "pin added-2 w1",
        ])
        #expect(store.adding == .idle)
    }

    @Test func inputThatIsNeitherAPathNorAURLIsRefusedWithoutAsking() async {
        let store = WorkspaceStore(workspaceId: "w1", backend: backend)
        #expect(await store.addRepo("atlas") == false)
        #expect(backend.calls.isEmpty)
        guard case .failed(let problem) = store.adding else {
            Issue.record("the input was accepted")
            return
        }
        #expect(problem.fix == nil)
    }

    @Test func aFailedAddShowsTheEnginesMessageAndCode() async {
        backend.failures["addRepo"] = .noRemote
        let store = WorkspaceStore(workspaceId: "w1", backend: backend)
        #expect(await store.addRepo("/work/plain") == false)
        #expect(store.adding == .failed(WorkspaceProblem(message: "/work/plain has no remote", code: .invalidParams)))
        #expect(!backend.calls.contains { $0.hasPrefix("pin") })
        store.clearAddProblem()
        #expect(store.adding == .idle)
    }

    @Test func syncReportsWhatChangedOrTheProblemWithItsFix() async {
        let store = WorkspaceStore(workspaceId: "w1", backend: backend)
        await store.syncNow()
        #expect(store.sync == .synced(added: 2, removed: 0))
        #expect(SyncStatus.summary(store.sync, sources: 1) == "Synced: 2 repos added.")

        backend.failures["sync"] = .ssoRequired
        await store.syncNow()
        guard case .failed(let problem) = store.sync else {
            Issue.record("the sync did not fail")
            return
        }
        #expect(problem.fix?.label == "Authorize for single sign-on")
        #expect(SyncStatus.summary(store.sync, sources: 1) == "Sync failed.")
    }

    @Test func managerCreatesAWorkspaceAndHandsItOn() async {
        let manager = WorkspaceManager(backend: backend, fixes: FixPerformer(openURL: { _ in }, copy: { _ in }))
        var created: [String] = []
        manager.onCreated = { created.append($0.name) }
        #expect(await manager.createWorkspace(named: "  ") == false)
        #expect(await manager.createWorkspace(named: " Payments "))
        #expect(created == ["Payments"])
        #expect(manager.store(for: "w1") === manager.store(for: "w1"))
    }
}

@Suite struct RepoLocationTests {
    @Test(arguments: [
        ("/work/atlas", RepoLocation.path("/work/atlas")),
        ("/work/atlas/../beacon/", .path("/work/beacon")),
        ("~/src/atlas", .path("/Users/tester/src/atlas")),
        ("~", .path("/Users/tester")),
        ("https://git.example.com/acme/atlas", .url("https://git.example.com/acme/atlas")),
        ("ssh://git@github.com/acme/atlas.git", .url("ssh://git@github.com/acme/atlas.git")),
        ("git@github.com:acme/atlas.git", .url("git@github.com:acme/atlas.git")),
    ])
    func classifies(input: String, expected: RepoLocation) {
        #expect(RepoLocation(input, homeDirectory: "/Users/tester") == expected)
    }

    @Test(arguments: ["", "   ", "atlas", "src/atlas", "git@github.com:"])
    func refuses(input: String) {
        #expect(RepoLocation(input, homeDirectory: "/Users/tester") == nil)
    }
}

@Suite struct SyncStatusTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func sourceLabels() {
        #expect(SyncStatus.sourceLabel(lastSyncedAt: nil, now: now) == "Not synced yet")
        let recent = ISO8601DateFormatter().string(from: now.addingTimeInterval(-20))
        #expect(SyncStatus.sourceLabel(lastSyncedAt: recent, now: now) == "Synced just now")
        let earlier = ISO8601DateFormatter().string(from: now.addingTimeInterval(-300))
        #expect(SyncStatus.sourceLabel(lastSyncedAt: earlier, now: now).hasPrefix("Synced 5 minutes"))
    }

    @Test func summaries() {
        #expect(SyncStatus.summary(.idle, sources: 0) == "Import a team to sync repos from GitHub.")
        #expect(SyncStatus.summary(.synced(added: 0, removed: 0), sources: 1) == "Up to date.")
        #expect(SyncStatus.summary(.synced(added: 1, removed: 2), sources: 1) == "Synced: 1 repo added, 2 removed.")
        #expect(SyncStatus.summary(.synced(added: 0, removed: 1), sources: 1) == "Synced: 1 repo removed.")
    }
}
