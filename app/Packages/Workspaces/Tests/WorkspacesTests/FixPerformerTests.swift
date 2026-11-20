@testable import Workspaces
import EngineClient
import Foundation
import PicaProtocol
import Testing

/// PLAN.md A-12: auth errors display their `fix` action. Each kind of fix the engine sends does what its button says.
@Suite struct FixPerformerTests {
    final class Recorder: @unchecked Sendable {
        private let lock = NSLock()
        private var entries: [String] = []

        func add(_ entry: String) { lock.withLock { entries.append(entry) } }
        var all: [String] { lock.withLock { entries } }
    }

    let recorder = Recorder()

    var performer: FixPerformer {
        let recorder = recorder
        return FixPerformer(openURL: { recorder.add("open \($0.absoluteString)") }, copy: { recorder.add("copy \($0)") })
    }

    @Test func anSSOFixOpensTheAuthorizationURL() {
        let fix = FixAction(kind: .openUrl, label: "Authorize for single sign-on", target: "https://git.example.com/orgs/acme/sso")
        #expect(performer.perform(fix) == .done)
        #expect(recorder.all == ["open https://git.example.com/orgs/acme/sso"])
    }

    @Test func aScopeFixCopiesTheCommandAndSaysSo() {
        let command = "gh auth refresh --hostname github.com --scopes read:org"
        let outcome = performer.perform(FixAction(kind: .runCommand, label: "Grant read:org to the gh CLI", target: command))
        #expect(outcome == .note("Copied “\(command)”. Run it in Terminal, then try again."))
        #expect(recorder.all == ["copy \(command)"])
    }

    @Test func signingInCopiesTheGitHubCLILoginForTheHost() {
        _ = performer.perform(FixAction(kind: .signIn, label: "Sign in to github.com", target: "github.com"))
        _ = performer.perform(FixAction(kind: .signIn, label: "Sign in", target: "ghe.example.test"))
        #expect(recorder.all == [
            "copy gh auth login --scopes read:org",
            "copy gh auth login --hostname ghe.example.test --scopes read:org",
        ])
    }

    @Test func retryAndSettingsAreLeftToTheCaller() {
        #expect(performer.perform(FixAction(kind: .retry, label: "Try again")) == .retry)
        #expect(performer.perform(FixAction(kind: .openSettings, label: "Open Settings")) == .openSettings)
        #expect(recorder.all.isEmpty)
    }

    @Test func anEngineErrorKeepsItsCodeAndFix() {
        let problem = WorkspaceProblem(EngineClientError.engine(.ssoRequired))
        #expect(problem.code == .authSsoRequired)
        #expect(problem.fix?.target == "https://git.example.com/orgs/vault-corp/sso")
        #expect(WorkspaceProblem(EngineClientError.notConnected).fix?.kind == .retry)
    }

    @Test func underUITestsEachFixIsLogged() throws {
        let log = FileManager.default.temporaryDirectory.appending(path: "fix-\(UUID().uuidString).log")
        defer { try? FileManager.default.removeItem(at: log) }
        let performer = FixPerformer.system(environment: ["PICA_FIX_ACTION_LOG": log.path])
        _ = performer.perform(FixAction(kind: .openUrl, label: "Open", target: "https://example.test/a"))
        _ = performer.perform(FixAction(kind: .runCommand, label: "Run", target: "gh auth status"))
        #expect(try String(contentsOf: log, encoding: .utf8) == "open_url https://example.test/a\ncopy gh auth status\n")
    }
}
