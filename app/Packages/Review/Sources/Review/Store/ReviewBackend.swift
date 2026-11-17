import EngineClient
import Foundation
import PicaProtocol

/// Which change a stage, unstage or discard acts on: a whole file, or some of its hunks.
public struct ChangeTarget: Hashable, Sendable {
    public let path: String
    /// nil for the whole file.
    public let hunkIndexes: [Int]?

    public init(path: String, hunkIndexes: [Int]? = nil) {
        self.path = path
        self.hunkIndexes = hunkIndexes
    }
}

/// The engine calls the review makes. Swift never runs git itself: every change goes through the engine
/// (`tools/lint/swift-boundary.sh`). `EngineReviewBackend` makes them over `EngineClient`; tests use a fake.
public protocol ReviewBackend: Sendable {
    func repos(workspaceId: Id) async throws -> [Repo]
    func status(sessionId: Id, repoId: Id) async throws -> GitStatus
    func diff(sessionId: Id, repoId: Id, staged: Bool) async throws -> [FileDiff]
    func stage(sessionId: Id, repoId: Id, _ target: ChangeTarget) async throws
    func unstage(sessionId: Id, repoId: Id, _ target: ChangeTarget) async throws
    func discard(sessionId: Id, repoId: Id, _ target: ChangeTarget) async throws
    func commit(sessionId: Id, repoId: Id, message: String) async throws -> Commit
    func push(sessionId: Id, repoId: Id) async throws
    func createPullRequest(sessionId: Id, repoId: Id, title: String, body: String, base: String?) async throws -> PullRequest
}

public struct EngineReviewBackend: ReviewBackend {
    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func repos(workspaceId: Id) async throws -> [Repo] {
        try await client.request(Methods.RepoList.self, RepoListParams(workspaceId: workspaceId)).repos
    }

    public func status(sessionId: Id, repoId: Id) async throws -> GitStatus {
        try await client.request(Methods.GitStatus.self, ByWorktree(sessionId: sessionId, repoId: repoId)).status
    }

    public func diff(sessionId: Id, repoId: Id, staged: Bool) async throws -> [FileDiff] {
        try await client.request(Methods.GitDiff.self, GitDiffParams(sessionId: sessionId, repoId: repoId, staged: staged)).files
    }

    public func stage(sessionId: Id, repoId: Id, _ target: ChangeTarget) async throws {
        _ = try await client.request(
            Methods.GitStage.self,
            GitStageParams(sessionId: sessionId, repoId: repoId, path: target.path, hunkIndexes: target.hunkIndexes))
    }

    public func unstage(sessionId: Id, repoId: Id, _ target: ChangeTarget) async throws {
        _ = try await client.request(
            Methods.GitUnstage.self,
            GitUnstageParams(sessionId: sessionId, repoId: repoId, path: target.path, hunkIndexes: target.hunkIndexes))
    }

    public func discard(sessionId: Id, repoId: Id, _ target: ChangeTarget) async throws {
        _ = try await client.request(
            Methods.GitDiscard.self,
            GitDiscardParams(sessionId: sessionId, repoId: repoId, path: target.path, hunkIndexes: target.hunkIndexes))
    }

    public func commit(sessionId: Id, repoId: Id, message: String) async throws -> Commit {
        try await client.request(Methods.GitCommit.self, GitCommitParams(sessionId: sessionId, repoId: repoId, message: message)).commit
    }

    public func push(sessionId: Id, repoId: Id) async throws {
        // A push can wait on the network well past the default timeout.
        _ = try await client.request(Methods.GitPush.self, ByWorktree(sessionId: sessionId, repoId: repoId), timeout: .seconds(120))
    }

    public func createPullRequest(sessionId: Id, repoId: Id, title: String, body: String, base: String?) async throws -> PullRequest {
        try await client.request(
            Methods.GithubCreatePullRequest.self,
            GithubCreatePullRequestParams(sessionId: sessionId, repoId: repoId, title: title, body: body, base: base),
            timeout: .seconds(60)
        ).pullRequest
    }
}
