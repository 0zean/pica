import Foundation
@testable import Onboarding
import PicaProtocol

/// Answers each check from what a test sets, and counts the calls.
final class FakeOnboardingBackend: OnboardingBackend, @unchecked Sendable {
    private let lock = NSLock()
    private var _account = EngineAccountResult.Account(status: .signedIn, login: "octo", authType: "user", host: nil, message: nil)
    private var _git = GitInstall(status: .installed, version: "2.39.5", message: nil)
    private var _gitHub = GitHubAuthStatus(host: "github.com", signedIn: true, provider: .gh, login: "octo", scopes: ["read:org"])
    private var _failure: (any Error)?

    var account: EngineAccountResult.Account {
        get { lock.withLock { _account } }
        set { lock.withLock { _account = newValue } }
    }

    var git: GitInstall {
        get { lock.withLock { _git } }
        set { lock.withLock { _git = newValue } }
    }

    var gitHub: GitHubAuthStatus {
        get { lock.withLock { _gitHub } }
        set { lock.withLock { _gitHub = newValue } }
    }

    /// Every call throws this while it is set.
    var failure: (any Error)? {
        get { lock.withLock { _failure } }
        set { lock.withLock { _failure = newValue } }
    }

    func copilotAccount() async throws -> EngineAccountResult.Account {
        if let failure { throw failure }
        return account
    }

    func gitInstall() async throws -> GitInstall {
        if let failure { throw failure }
        return git
    }

    func gitHubAuth() async throws -> GitHubAuthStatus {
        if let failure { throw failure }
        return gitHub
    }
}
