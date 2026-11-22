@testable import Workspaces
import EngineClient
import Foundation
import PicaProtocol

/// Records each call and answers from fixed data; a method listed in `failures` throws that error instead.
@MainActor
final class FakeWorkspacesBackend: WorkspacesBackend, @unchecked Sendable {
    var account = GitHubAuthStatus(host: "github.com", signedIn: true, provider: .gh, login: "octo", scopes: ["read:org"])
    var teamList = [
        GitHubTeam(org: "acme", slug: "payments", name: "Payments"),
        GitHubTeam(org: "acme", slug: "platform", name: "Platform"),
        GitHubTeam(org: "vault-corp", slug: "vault", name: "Vault"),
    ]
    var reposByTeam: [String: [GitHubRepo]] = [
        "acme/platform": [.fixture("acme/atlas"), .fixture("acme/beacon")],
    ]
    var syncResult = WorkspaceSyncResult(added: ["r1", "r2"], removed: [])
    var failures: [String: RpcError] = [:]
    /// What `addRepo(url:)` answers with instead of a new repo: a registered repo cloned in place.
    var clonedInPlace: Repo?
    private(set) var calls: [String] = []
    private var nextRepo = 0

    private func record(_ call: String, _ method: String) throws {
        calls.append(call)
        if let error = failures[method] { throw EngineClientError.engine(error) }
    }

    nonisolated func createWorkspace(name: String) async throws -> Workspace {
        try await MainActor.run {
            try record("create \(name)", "createWorkspace")
            return Workspace(id: "w-new", name: name, sources: [], pinnedRepoIds: [], overrides: WorkspaceOverrides())
        }
    }

    nonisolated func renameWorkspace(_ workspaceId: Id, to name: String) async throws -> Workspace {
        try await MainActor.run {
            try record("rename \(workspaceId) \(name)", "renameWorkspace")
            return Workspace(id: workspaceId, name: name, sources: [], pinnedRepoIds: [], overrides: WorkspaceOverrides())
        }
    }

    nonisolated func deleteWorkspace(_ workspaceId: Id) async throws {
        try await MainActor.run { try record("delete \(workspaceId)", "deleteWorkspace") }
    }

    nonisolated func removeRepo(_ repoId: Id, from workspaceId: Id) async throws {
        try await MainActor.run { try record("removeRepo \(repoId) \(workspaceId)", "removeRepo") }
    }

    nonisolated func forgetRepo(_ repoId: Id) async throws {
        try await MainActor.run { try record("forgetRepo \(repoId)", "forgetRepo") }
    }

    nonisolated func addRepo(path: String) async throws -> Repo {
        try await MainActor.run {
            try record("addPath \(path)", "addRepo")
            return newRepo(localPath: path, remoteUrl: nil)
        }
    }

    nonisolated func addRepo(url: String) async throws -> Repo {
        try await MainActor.run {
            try record("addUrl \(url)", "addRepo")
            if let clonedInPlace { return clonedInPlace }
            return newRepo(localPath: "/managed/repo", remoteUrl: url)
        }
    }

    private func newRepo(localPath: String, remoteUrl: String?) -> Repo {
        nextRepo += 1
        return Repo(
            id: "added-\(nextRepo)", remoteUrl: remoteUrl, localPath: localPath, managed: remoteUrl != nil,
            defaultBranch: "main", cloneState: .cloned)
    }

    nonisolated func pin(repoId: Id, to workspaceId: Id) async throws {
        try await MainActor.run { try record("pin \(repoId) \(workspaceId)", "pin") }
    }

    nonisolated func addTeamSource(to workspaceId: Id, org: String, teamSlug: String) async throws -> RepoSource {
        try await MainActor.run {
            try record("addSource \(workspaceId) \(org)/\(teamSlug)", "addSource.\(org)/\(teamSlug)")
            return RepoSource(id: "s-\(teamSlug)", kind: .team, org: org, selector: teamSlug, lastSyncedAt: nil)
        }
    }

    nonisolated func removeSource(_ sourceId: Id, from workspaceId: Id) async throws {
        try await MainActor.run { try record("removeSource \(sourceId)", "removeSource") }
    }

    nonisolated func sync(workspaceId: Id) async throws -> WorkspaceSyncResult {
        try await MainActor.run {
            try record("sync \(workspaceId)", "sync")
            return syncResult
        }
    }

    nonisolated func authStatus() async throws -> GitHubAuthStatus {
        try await MainActor.run {
            try record("authStatus", "authStatus")
            return account
        }
    }

    nonisolated func teams() async throws -> [GitHubTeam] {
        try await MainActor.run {
            try record("teams", "teams")
            return teamList
        }
    }

    nonisolated func createSession(
        workspaceId: Id, writeRepoIds: [Id], referenceRepoIds: [Id], prompt: String?
    ) async throws -> Session {
        try await MainActor.run {
            try record(
                "createSession \(workspaceId) write=\(writeRepoIds) reference=\(referenceRepoIds) prompt=\(prompt ?? "-")",
                "createSession")
            return Session(
                id: "s-new", workspaceId: workspaceId, title: "", state: .starting, writeRoots: [], referenceRoots: [],
                routingProfile: .off, budgetCredits: nil, lastSeq: 0, createdAt: "2026-11-21T00:00:00Z",
                updatedAt: "2026-11-21T00:00:00Z")
        }
    }

    nonisolated func teamRepos(org: String, teamSlug: String) async throws -> [GitHubRepo] {
        try await MainActor.run {
            try record("teamRepos \(org)/\(teamSlug)", "teamRepos.\(org)/\(teamSlug)")
            return reposByTeam["\(org)/\(teamSlug)"] ?? []
        }
    }
}

extension GitHubRepo {
    static func fixture(_ fullName: String) -> GitHubRepo {
        GitHubRepo(fullName: fullName, cloneUrl: "https://git.example.com/\(fullName).git", archived: false, fork: false, topics: [])
    }
}

extension RpcError {
    static let ssoRequired = RpcError(
        code: -32000, message: "An organization on github.com uses SAML single sign-on.",
        data: ErrorData(
            code: .authSsoRequired,
            fix: FixAction(kind: .openUrl, label: "Authorize for single sign-on", target: "https://git.example.com/orgs/vault-corp/sso")))
    static let sourceExists = RpcError(
        code: -32000, message: "the workspace already has this source", data: ErrorData(code: .alreadyExists))
    static let dailyCap = RpcError(
        code: -32000, message: "workspace w1 has used 500 of its 500 daily credits; the cap resets at 2026-11-22T00:00:00Z",
        data: ErrorData(code: .budgetExhausted, fix: FixAction(kind: .openSettings, label: "Open Budget Settings")))
    static let hasLocalWork = RpcError(
        code: -32000, message: "/managed/atlas has 2 uncommitted path(s) and 0 unpushed commit(s); remove it with force to discard them",
        data: ErrorData(code: .refusedWithoutForce))
    static let sessionsBusy = RpcError(
        code: -32000, message: "1 session(s) in this workspace are working or waiting for an approval",
        data: ErrorData(code: .invalidState))
    static let noRemote = RpcError(
        code: -32602, message: "/work/plain has no remote", data: ErrorData(code: .invalidParams))
}
