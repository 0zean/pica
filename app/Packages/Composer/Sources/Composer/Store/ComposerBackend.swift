import EngineClient
import Foundation
import PicaProtocol

/// The engine calls the composer makes. `EngineComposerBackend` makes them over `EngineClient`; tests use a fake.
public protocol ComposerBackend: Sendable {
    /// `session.send`; false when the engine did not accept it (a `send` while a turn runs).
    func send(sessionId: Id, text: String, mode: SendMode) async throws -> Bool
    func abort(sessionId: Id) async throws
    func repos(workspaceId: Id) async throws -> [Repo]
    func agents(workspaceId: Id) async throws -> [AgentDef]
    /// Skill names: the directories under each repo's skill folders (docs/composer.md).
    func skills(repoIds: [Id]) async -> [String]
    func files(workspaceId: Id, query: String, limit: Int) async throws -> [QuickOpenHit]
    func models() async throws -> [ModelInfo]
    func tiers() async throws -> [TierAssignment]
    func workspace(_ workspaceId: Id) async throws -> Workspace
    /// Sets the routing profile new sessions in the workspace start with.
    func setDefaultProfile(_ profile: RoutingProfile, workspaceId: Id) async throws
}

public struct EngineComposerBackend: ComposerBackend {
    /// Where Copilot looks for a repo's skills, one directory per skill.
    static let skillDirectories = [".github/skills", ".claude/skills"]

    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func send(sessionId: Id, text: String, mode: SendMode) async throws -> Bool {
        try await client.request(Methods.SessionSend.self, SessionSendParams(sessionId: sessionId, text: text, mode: mode)).accepted
    }

    public func abort(sessionId: Id) async throws {
        _ = try await client.request(Methods.SessionAbort.self, BySession(sessionId: sessionId))
    }

    public func repos(workspaceId: Id) async throws -> [Repo] {
        try await client.request(Methods.RepoList.self, RepoListParams(workspaceId: workspaceId)).repos
    }

    public func agents(workspaceId: Id) async throws -> [AgentDef] {
        try await client.request(Methods.AgentsList.self, AgentsListParams(workspaceId: workspaceId)).agents
    }

    public func skills(repoIds: [Id]) async -> [String] {
        var names: [String] = []
        for repoId in repoIds {
            for directory in Self.skillDirectories {
                // A repo without the folder answers with an error; it has no skills there.
                let entries = try? await client.request(
                    Methods.FilesList.self, FilesListParams(repoId: repoId, directory: directory)
                ).entries
                for entry in entries ?? [] where entry.kind == .directory {
                    names.append(String(entry.path.split(separator: "/").last ?? Substring(entry.path)))
                }
            }
        }
        return names
    }

    public func files(workspaceId: Id, query: String, limit: Int) async throws -> [QuickOpenHit] {
        try await client.request(
            Methods.FilesQuickOpen.self, FilesQuickOpenParams(workspaceId: workspaceId, query: query, limit: limit)
        ).hits
    }

    public func models() async throws -> [ModelInfo] {
        try await client.request(Methods.ModelsList.self).models
    }

    public func tiers() async throws -> [TierAssignment] {
        try await client.request(Methods.ModelsTiers.self).tiers
    }


    public func workspace(_ workspaceId: Id) async throws -> Workspace {
        try await client.request(Methods.WorkspaceGet.self, ById(id: workspaceId)).workspace
    }

    public func setDefaultProfile(_ profile: RoutingProfile, workspaceId: Id) async throws {
        var overrides = try await workspace(workspaceId).overrides
        overrides.routingProfile = profile
        _ = try await client.request(
            Methods.WorkspaceUpdate.self, WorkspaceUpdateParams(id: workspaceId, overrides: overrides))
    }
}
