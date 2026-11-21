import EngineClient
import Foundation
import PicaProtocol

/// The engine calls onboarding's precondition checks make (docs/onboarding.md). `EngineOnboardingBackend` makes them
/// over `EngineClient`; tests use a fake.
public protocol OnboardingBackend: Sendable {
    func copilotAccount() async throws -> EngineAccountResult.Account
    func gitInstall() async throws -> GitInstall
    func gitHubAuth() async throws -> GitHubAuthStatus
}

public struct EngineOnboardingBackend: OnboardingBackend {
    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func copilotAccount() async throws -> EngineAccountResult.Account {
        try await client.request(Methods.EngineAccount.self).account
    }

    public func gitInstall() async throws -> GitInstall {
        try await client.request(Methods.EngineGit.self).git
    }

    public func gitHubAuth() async throws -> GitHubAuthStatus {
        try await client.request(Methods.GithubAuthStatus.self, GithubAuthStatusParams())
    }
}
