import EngineClient
import Foundation
import PicaProtocol

/// The engine calls workspace and repo management makes (docs/workspaces.md). `EngineWorkspacesBackend` makes them
/// over `EngineClient`; tests use a fake.
public protocol WorkspacesBackend: Sendable {
    func createWorkspace(name: String) async throws -> Workspace
    func renameWorkspace(_ workspaceId: Id, to name: String) async throws -> Workspace
    /// Refused (`invalid_state`) while a session is open; otherwise deletes the workspace's sessions too.
    func deleteWorkspace(_ workspaceId: Id) async throws
    /// Takes the repo out of the workspace: unpins it and keeps its sources from adding it back.
    func removeRepo(_ repoId: Id, from workspaceId: Id) async throws
    /// `repo.remove` without force: forgets the repo and deletes its managed clone; refused with local work.
    func forgetRepo(_ repoId: Id) async throws
    func addRepo(path: String) async throws -> Repo
    /// Clones the repo into Pica's managed directory, so it can take as long as the clone does.
    func addRepo(url: String) async throws -> Repo
    func pin(repoId: Id, to workspaceId: Id) async throws
    func addTeamSource(to workspaceId: Id, org: String, teamSlug: String) async throws -> RepoSource
    func removeSource(_ sourceId: Id, from workspaceId: Id) async throws
    func sync(workspaceId: Id) async throws -> WorkspaceSyncResult
    func authStatus() async throws -> GitHubAuthStatus
    func teams() async throws -> [GitHubTeam]
    func teamRepos(org: String, teamSlug: String) async throws -> [GitHubRepo]
    /// Starts a session whose roots are the given repos; it can take as long as the runtime takes to open.
    func createSession(workspaceId: Id, writeRepoIds: [Id], referenceRepoIds: [Id], prompt: String?) async throws -> Session
}

public struct EngineWorkspacesBackend: WorkspacesBackend {
    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func createWorkspace(name: String) async throws -> Workspace {
        try await client.request(Methods.WorkspaceCreate.self, WorkspaceCreateParams(name: name)).workspace
    }

    public func renameWorkspace(_ workspaceId: Id, to name: String) async throws -> Workspace {
        try await client.request(Methods.WorkspaceUpdate.self, WorkspaceUpdateParams(id: workspaceId, name: name)).workspace
    }

    public func deleteWorkspace(_ workspaceId: Id) async throws {
        _ = try await client.request(Methods.WorkspaceDelete.self, ById(id: workspaceId))
    }

    public func removeRepo(_ repoId: Id, from workspaceId: Id) async throws {
        _ = try await client.request(
            Methods.WorkspaceRemoveRepo.self, WorkspaceRemoveRepoParams(workspaceId: workspaceId, repoId: repoId))
    }

    /// Checking for local work and deleting a clone can take a while on a big repo.
    public func forgetRepo(_ repoId: Id) async throws {
        _ = try await client.request(Methods.RepoRemove.self, RepoRemoveParams(id: repoId, force: false), timeout: .seconds(120))
    }

    public func addRepo(path: String) async throws -> Repo {
        try await client.request(Methods.RepoAddPath.self, RepoAddPathParams(path: path)).repo
    }

    public func addRepo(url: String) async throws -> Repo {
        try await client.request(Methods.RepoAddUrl.self, RepoAddUrlParams(url: url), timeout: .seconds(900)).repo
    }

    public func pin(repoId: Id, to workspaceId: Id) async throws {
        _ = try await client.request(
            Methods.WorkspacePinRepo.self, WorkspacePinRepoParams(workspaceId: workspaceId, repoId: repoId))
    }

    public func addTeamSource(to workspaceId: Id, org: String, teamSlug: String) async throws -> RepoSource {
        try await client.request(
            Methods.WorkspaceAddSource.self,
            WorkspaceAddSourceParams(workspaceId: workspaceId, kind: .team, org: org, selector: teamSlug)
        ).source
    }

    public func removeSource(_ sourceId: Id, from workspaceId: Id) async throws {
        _ = try await client.request(
            Methods.WorkspaceRemoveSource.self, WorkspaceRemoveSourceParams(workspaceId: workspaceId, sourceId: sourceId))
    }

    /// Lists every source's repos on GitHub, page by page, so it gets more time than an ordinary request.
    public func sync(workspaceId: Id) async throws -> WorkspaceSyncResult {
        try await client.request(
            Methods.WorkspaceSync.self, WorkspaceSyncParams(workspaceId: workspaceId), timeout: .seconds(120))
    }

    public func authStatus() async throws -> GitHubAuthStatus {
        try await client.request(Methods.GithubAuthStatus.self, GithubAuthStatusParams())
    }

    public func teams() async throws -> [GitHubTeam] {
        try await client.request(Methods.GithubListTeams.self, GithubListTeamsParams(), timeout: .seconds(60)).teams
    }

    public func teamRepos(org: String, teamSlug: String) async throws -> [GitHubRepo] {
        try await client.request(
            Methods.GithubListTeamRepos.self, GithubListTeamReposParams(org: org, teamSlug: teamSlug),
            timeout: .seconds(60)
        ).repos
    }

    public func createSession(
        workspaceId: Id, writeRepoIds: [Id], referenceRepoIds: [Id], prompt: String?
    ) async throws -> Session {
        try await client.request(
            Methods.SessionCreate.self,
            SessionCreateParams(
                workspaceId: workspaceId, writeRepoIds: writeRepoIds, referenceRepoIds: referenceRepoIds, prompt: prompt),
            timeout: .seconds(60)
        ).session
    }
}
