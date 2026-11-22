@testable import Workspaces
import Foundation
import PicaProtocol
import Testing

/// New Session (⌘N): choosing roots, the reasons Start is off, starting, and the problems the engine reports.
@MainActor
@Suite struct NewSessionStoreTests {
    let backend = FakeWorkspacesBackend()

    static func repo(_ name: String, cloned: Bool = true) -> Repo {
        Repo(
            id: "r-\(name)", remoteUrl: "https://git.example.com/acme/\(name).git",
            localPath: cloned ? "/work/\(name)" : nil, managed: !cloned, defaultBranch: "main",
            cloneState: cloned ? .cloned : .available)
    }

    let atlas = repo("atlas")
    let beacon = repo("beacon")
    let ledger = repo("ledger", cloned: false)

    @Test func theOnlyUsableRepoIsChosenToWriteToAndAPromptIsSent() async {
        let store = NewSessionStore(workspaceId: "w1", backend: backend)
        let repos = [atlas, ledger]
        store.applyDefaults(repos: repos)
        #expect(store.role(of: atlas.id) == .write)
        #expect(store.role(of: ledger.id) == .unused)
        store.prompt = "  fix the flaky test \n"
        let session = await store.start(repos: repos)
        #expect(session?.id == "s-new")
        #expect(backend.calls == ["createSession w1 write=[\"r-atlas\"] reference=[] prompt=fix the flaky test"])
    }

    @Test func withSeveralReposNothingIsChosenAndStartSaysWhy() async {
        let store = NewSessionStore(workspaceId: "w1", backend: backend)
        let repos = [atlas, beacon]
        store.applyDefaults(repos: repos)
        #expect(store.startBlocker(repos: repos) == "Choose a repository to write to or reference.")
        #expect(await store.start(repos: repos) == nil)
        #expect(backend.calls.isEmpty)

        store.setRole(.write, for: beacon.id)
        store.setRole(.reference, for: atlas.id)
        #expect(store.startBlocker(repos: repos) == nil)
        _ = await store.start(repos: repos)
        // Workspace order, and an empty prompt is left out.
        #expect(backend.calls == ["createSession w1 write=[\"r-beacon\"] reference=[\"r-atlas\"] prompt=-"])
    }

    @Test func aRepoThatIsNotClonedIsNeverSentEvenIfChosen() async {
        let store = NewSessionStore(workspaceId: "w1", backend: backend)
        store.setRole(.write, for: ledger.id)
        #expect(store.startBlocker(repos: [ledger]) == "Clone a repository to start a session in it.")
        store.setRole(.write, for: atlas.id)
        _ = await store.start(repos: [atlas, ledger])
        #expect(backend.calls == ["createSession w1 write=[\"r-atlas\"] reference=[] prompt=-"])
    }

    @Test func noWorkspaceOrNoReposIsAReasonBeforeTheSheetOpens() {
        #expect(NewSessionStore.unavailableReason(workspaceId: nil, repos: []) == "Select a workspace to start a session in.")
        #expect(NewSessionStore.unavailableReason(workspaceId: "w1", repos: []) == "Add a repository to this workspace first.")
        #expect(NewSessionStore.unavailableReason(workspaceId: "w1", repos: [ledger]) == nil)
    }

    @Test func theDailyCapIsShownWithItsFixAndClearsWhenTheChoiceChanges() async {
        backend.failures["createSession"] = .dailyCap
        let store = NewSessionStore(workspaceId: "w1", backend: backend)
        store.applyDefaults(repos: [atlas])
        #expect(await store.start(repos: [atlas]) == nil)
        #expect(store.problem?.code == .budgetExhausted)
        #expect(store.problem?.fix?.kind == .openSettings)
        #expect(store.isStarting == false)
        store.setRole(.reference, for: atlas.id)
        #expect(store.problem == nil)
    }

    @Test func cloningARepoReplacesTheListedOneAndChoosesIt() async {
        backend.clonedInPlace = Repo(
            id: ledger.id, remoteUrl: ledger.remoteUrl, localPath: "/managed/ledger", managed: true, defaultBranch: "main",
            cloneState: .cloned)
        let store = NewSessionStore(workspaceId: "w1", backend: backend)
        store.applyDefaults(repos: [atlas, beacon, ledger])
        await store.clone(ledger)
        #expect(backend.calls == ["addUrl https://git.example.com/acme/ledger.git"])
        #expect(store.current([atlas, ledger]).map(\.localPath) == ["/work/atlas", "/managed/ledger"])
        #expect(store.role(of: ledger.id) == .write)
        #expect(store.cloning.isEmpty)
        #expect(store.startBlocker(repos: [atlas, ledger]) == nil)
    }

    @Test func aFailedCloneShowsItsProblem() async {
        backend.failures["addRepo"] = .noRemote
        let store = NewSessionStore(workspaceId: "w1", backend: backend)
        await store.clone(ledger)
        #expect(store.cloneProblem?.code == .invalidParams)
        #expect(store.role(of: ledger.id) == .unused)
    }

    @Test func managerStartsTheSessionAndHandsItOn() async {
        let manager = WorkspaceManager(backend: backend, fixes: FixPerformer(openURL: { _ in }, copy: { _ in }))
        manager.repos = { [atlas] _ in [atlas] }
        var opened: [Id] = []
        manager.onSessionCreated = { opened.append($0.id) }
        #expect(manager.newSessionUnavailableReason(workspaceId: nil) != nil)
        #expect(manager.newSessionUnavailableReason(workspaceId: "w1") == nil)

        manager.presentNewSession(workspaceId: "w1")
        #expect(manager.sheet == .newSession(workspaceId: "w1"))
        manager.newSession?.applyDefaults(repos: [atlas])
        #expect(await manager.startSession())
        #expect(opened == ["s-new"])

        // Each presentation starts afresh.
        manager.presentNewSession(workspaceId: "w1")
        #expect(manager.newSession?.role(of: atlas.id) == .unused)
    }
}
