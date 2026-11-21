import EngineClient
@testable import Onboarding
import PicaProtocol
import Testing

@MainActor
@Suite struct OnboardingStoreTests {
    let backend = FakeOnboardingBackend()

    private func makeStore(
        fixes: @escaping @MainActor (FixAction) -> String? = { _ in nil },
        create: @escaping @MainActor (String) async -> String? = { _ in nil }
    ) -> OnboardingStore {
        OnboardingStore(backend: backend, performFix: fixes, createWorkspace: create)
    }

    @Test func everyPassingCheckGoesStraightToTheWorkspace() async {
        let store = makeStore()
        await store.start()
        #expect(store.step == .workspace)
        #expect(store.state(of: .copilot) == .done(.passed("Signed in as octo.")))
        #expect(store.state(of: .gitInstall) == .done(.passed("Git 2.39.5.")))
        #expect(store.state(of: .github) == .done(.passed("Signed in to github.com as octo.")))
    }

    @Test func eachFailingCheckIsTheStepUntilItPassesThenTheNextOne() async {
        backend.account.status = .signedOut
        backend.account.message = "Not logged in"
        backend.git = GitInstall(status: .missing, version: nil, message: "xcode-select: note: No developer tools were found")
        backend.gitHub = GitHubAuthStatus(host: "github.com", signedIn: false, provider: nil, login: nil, scopes: [])
        let store = makeStore()
        await store.start()
        #expect(store.step == .check(.copilot))
        #expect(store.state(of: .copilot) == .done(.failed(message: "Not logged in", fix: CheckOutcomes.copilotSignIn)))

        backend.account = EngineAccountResult.Account(status: .signedIn, login: "octo", authType: "user", host: nil, message: nil)
        await store.check(.copilot)
        #expect(store.step == .check(.gitInstall))
        guard case .done(.failed(let message, let fix)) = store.state(of: .gitInstall) else {
            Issue.record("git did not fail")
            return
        }
        #expect(message.contains("No developer tools were found"))
        #expect(fix == CheckOutcomes.gitInstall)

        backend.git = GitInstall(status: .installed, version: "2.47.1", message: nil)
        await store.check(.gitInstall)
        #expect(store.step == .check(.github))
        #expect(store.state(of: .github) == .done(.failed(
            message: "Pica is not signed in to github.com, so it cannot list your teams.",
            fix: FixAction(kind: .signIn, label: "Sign in to github.com", target: "github.com"))))

        backend.gitHub = GitHubAuthStatus(host: "github.com", signedIn: true, provider: .gh, login: "octo", scopes: [])
        await store.check(.github)
        #expect(store.step == .workspace)
    }

    @Test func gitHubCanBeSkippedButCopilotAndGitCannot() async {
        backend.gitHub = GitHubAuthStatus(host: "github.com", signedIn: false, provider: nil, login: nil, scopes: [])
        let store = makeStore()
        await store.start()
        #expect(store.step == .check(.github))
        store.skipGitHub()
        #expect(store.step == .workspace)
        #expect(Precondition.copilot.isOptional == false)
        #expect(Precondition.gitInstall.isOptional == false)
    }

    @Test func aCopilotAccountWithNoModelsFailsWithTheEnginesHint() {
        let account = EngineAccountResult.Account(
            status: .noModels, login: nil, authType: nil, host: nil, message: "Run `copilot login` to sign in.")
        #expect(CheckOutcomes.copilot(account) == .failed(message: "Run `copilot login` to sign in.", fix: CheckOutcomes.copilotSignIn))
        let unknown = EngineAccountResult.Account(status: .unknown, login: nil, authType: nil, host: nil, message: nil)
        #expect(CheckOutcomes.copilot(unknown) == .passed("The runtime needs no sign-in."))
    }

    @Test func aFailedRequestFailsTheCheckWithTheEnginesMessageAndFix() async {
        let fix = FixAction(kind: .openUrl, label: "Authorize", target: "https://ghe.example.test/orgs/acme/sso")
        backend.failure = EngineClientError.engine(RpcError(
            code: -32_001, message: "SSO required", data: ErrorData(code: .authRequired, fix: fix)))
        let store = makeStore()
        await store.start()
        #expect(store.state(of: .copilot) == .done(.failed(message: "SSO required", fix: fix)))
        backend.failure = EngineClientError.notConnected
        await store.check(.gitInstall)
        #expect(store.state(of: .gitInstall) == .done(.failed(message: "Pica is not connected to its engine.", fix: nil)))
    }

    @Test func performingAFixShowsItsNoteUntilTheNextCheck() async {
        var performed: [FixAction] = []
        backend.account.status = .signedOut
        let store = makeStore(fixes: { fix in
            performed.append(fix)
            return "Copied “\(fix.target ?? "")”."
        })
        await store.start()
        store.fix(.copilot, with: CheckOutcomes.copilotSignIn)
        #expect(performed == [CheckOutcomes.copilotSignIn])
        #expect(store.fixNotes[.copilot] == "Copied “copilot login”.")
        await store.check(.copilot)
        #expect(store.fixNotes[.copilot] == nil)
    }

    @Test func theFirstWorkspaceIsCreatedUnderItsTrimmedNameOrSaysWhyNot() async {
        var names: [String] = []
        var refusal: String? = "A workspace needs a name the engine accepts."
        let store = makeStore(create: { name in
            names.append(name)
            return refusal
        })
        #expect(await store.createFirstWorkspace(named: "   ") == false)
        #expect(names.isEmpty)
        #expect(await store.createFirstWorkspace(named: "  Platform ") == false)
        #expect(store.workspaceProblem == "A workspace needs a name the engine accepts.")
        refusal = nil
        #expect(await store.createFirstWorkspace(named: "Platform"))
        #expect(names == ["Platform", "Platform"])
        #expect(store.workspaceProblem == nil)
    }
}
