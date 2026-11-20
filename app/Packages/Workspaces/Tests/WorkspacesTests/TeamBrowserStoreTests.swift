@testable import Workspaces
import Foundation
import PicaProtocol
import Testing

@MainActor
@Suite struct TeamBrowserStoreTests {
    let backend = FakeWorkspacesBackend()

    @Test func searchMatchesEveryWordInNameSlugOrOrganization() async {
        let store = TeamBrowserStore(backend: backend)
        await store.load()
        #expect(store.phase == .loaded)
        #expect(store.visibleTeams.map(\.id) == ["acme/payments", "acme/platform", "vault-corp/vault"])
        store.query = "ACME plat"
        #expect(store.visibleTeams.map(\.id) == ["acme/platform"])
        store.query = "vault-corp/"
        #expect(store.visibleTeams.map(\.id) == ["vault-corp/vault"])
        store.query = "nothing"
        #expect(store.visibleTeams.isEmpty)
    }

    @Test func severalTeamsAreChosenAndSelectAllCoversOnlyTheVisibleOnes() async {
        let store = TeamBrowserStore(backend: backend)
        await store.load()
        store.toggle(backend.teamList[0])
        store.toggle(backend.teamList[2])
        #expect(store.selectedTeams.map(\.id) == ["acme/payments", "vault-corp/vault"])
        store.toggle(backend.teamList[0])
        #expect(store.selectedTeams.map(\.id) == ["vault-corp/vault"])

        store.query = "acme"
        store.toggleAllVisible()
        #expect(store.selected == ["acme/payments", "acme/platform", "vault-corp/vault"])
        store.toggleAllVisible()
        #expect(store.selected == ["vault-corp/vault"])
    }

    @Test func importAddsEachChosenTeamThenSyncsOnce() async {
        let store = TeamBrowserStore(backend: backend)
        let workspace = WorkspaceStore(workspaceId: "w1", backend: backend)
        await store.load()
        store.toggle(backend.teamList[1])
        store.toggle(backend.teamList[0])
        #expect(await store.importSelected(into: workspace))
        #expect(backend.calls.suffix(3) == ["addSource w1 acme/payments", "addSource w1 acme/platform", "sync w1"])
        #expect(workspace.sync == .synced(added: 2, removed: 0))
        #expect(store.selected.isEmpty)
        #expect(store.importState == .idle)
    }

    @Test func aTeamTheWorkspaceAlreadyHasIsSkipped() async {
        backend.failures["addSource.acme/payments"] = .sourceExists
        let store = TeamBrowserStore(backend: backend)
        let workspace = WorkspaceStore(workspaceId: "w1", backend: backend)
        await store.load()
        store.toggle(backend.teamList[0])
        store.toggle(backend.teamList[1])
        #expect(await store.importSelected(into: workspace))
        #expect(backend.calls.last == "sync w1")
    }

    @Test func aFailedSyncKeepsTheChoiceAndCarriesTheFix() async throws {
        backend.failures["sync"] = .ssoRequired
        let store = TeamBrowserStore(backend: backend)
        let workspace = WorkspaceStore(workspaceId: "w1", backend: backend)
        await store.load()
        store.toggle(backend.teamList[2])
        #expect(await store.importSelected(into: workspace) == false)
        guard case .failed(let problem) = store.importState else {
            Issue.record("the import did not fail")
            return
        }
        #expect(problem.code == .authSsoRequired)
        #expect(problem.fix?.kind == .openUrl)
        #expect(problem.fix?.target == "https://github.com/orgs/vault-corp/sso")
        #expect(store.selected == ["vault-corp/vault"])
        #expect(workspace.sync == .failed(problem))
    }

    @Test func signedOutOffersSignInForTheHost() async {
        backend.account = GitHubAuthStatus(host: "ghe.example.test", signedIn: false, provider: nil, login: nil, scopes: [])
        let store = TeamBrowserStore(backend: backend)
        await store.load()
        guard case .failed(let problem) = store.phase else {
            Issue.record("signed out did not fail")
            return
        }
        #expect(problem.code == .authRequired)
        #expect(problem.fix == FixAction(kind: .signIn, label: "Sign in to ghe.example.test", target: "ghe.example.test"))
        #expect(!backend.calls.contains("teams"))
    }

    @Test func thePreviewListsTheFocusedTeamsReposOrItsProblem() async {
        backend.failures["teamRepos.vault-corp/vault"] = .ssoRequired
        let store = TeamBrowserStore(backend: backend)
        await store.load()
        store.focused = "acme/platform"
        await store.loadPreview()
        #expect(store.preview == .loaded("acme/platform", [.fixture("acme/atlas"), .fixture("acme/beacon")]))
        store.focused = "vault-corp/vault"
        await store.loadPreview()
        guard case .failed(let id, let problem) = store.preview else {
            Issue.record("the preview did not fail")
            return
        }
        #expect(id == "vault-corp/vault")
        #expect(problem.fix?.label == "Authorize for single sign-on")
    }
}
