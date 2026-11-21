import EngineClient
import Foundation
import PicaProtocol

/// Whose files the window shows: the user's, a workspace's over them, or one of its repos' over both.
public enum CustomizationScope: Hashable, Sendable {
    case user
    case workspace(Id)
    case repo(workspaceId: Id, repoId: Id)

    var workspaceId: Id? {
        switch self {
        case .user: nil
        case .workspace(let id): id
        case .repo(let workspaceId, _): workspaceId
        }
    }

    var repoId: Id? {
        if case .repo(_, let repoId) = self { return repoId }
        return nil
    }
}

/// The engine calls the Agents & Skills window makes (docs/agents.md). `EngineCustomizationBackend` makes them over
/// `EngineClient`; tests use a fake.
public protocol CustomizationBackend: Sendable {
    func list(_ kind: CustomizationKind, scope: CustomizationScope) async throws -> CustomizationListResult
    func create(_ kind: CustomizationKind, locationId: Id, name: String?, text: String, scope: CustomizationScope)
        async throws -> CustomizationItem
    func save(_ kind: CustomizationKind, path: AbsolutePath, text: String, scope: CustomizationScope) async throws
        -> CustomizationItem
    func delete(_ kind: CustomizationKind, path: AbsolutePath, scope: CustomizationScope) async throws
}

public struct EngineCustomizationBackend: CustomizationBackend {
    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func list(_ kind: CustomizationKind, scope: CustomizationScope) async throws -> CustomizationListResult {
        try await client.request(
            Methods.CustomizationList.self,
            CustomizationListParams(kind: kind, workspaceId: scope.workspaceId, repoId: scope.repoId))
    }

    public func create(_ kind: CustomizationKind, locationId: Id, name: String?, text: String, scope: CustomizationScope)
        async throws -> CustomizationItem
    {
        try await client.request(
            Methods.CustomizationCreate.self,
            CustomizationCreateParams(
                kind: kind, locationId: locationId, name: name, text: text, workspaceId: scope.workspaceId,
                repoId: scope.repoId)
        ).item
    }

    public func save(_ kind: CustomizationKind, path: AbsolutePath, text: String, scope: CustomizationScope)
        async throws -> CustomizationItem
    {
        try await client.request(
            Methods.CustomizationSave.self,
            CustomizationSaveParams(kind: kind, path: path, text: text, workspaceId: scope.workspaceId, repoId: scope.repoId)
        ).item
    }

    public func delete(_ kind: CustomizationKind, path: AbsolutePath, scope: CustomizationScope) async throws {
        _ = try await client.request(
            Methods.CustomizationDelete.self,
            CustomizationDeleteParams(kind: kind, path: path, workspaceId: scope.workspaceId, repoId: scope.repoId))
    }
}
