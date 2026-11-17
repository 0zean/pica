import EngineClient
import Foundation
import PicaProtocol

/// The engine calls the file tree, quick open and the viewer make. `EngineFilesBackend` makes them over
/// `EngineClient`; tests use a fake.
public protocol FilesBackend: Sendable {
    func repos(workspaceId: Id) async throws -> [Repo]
    /// The immediate children of `directory` ("" is the repo's root), directories first.
    func list(repoId: Id, directory: String) async throws -> [FileEntry]
    func read(repoId: Id, path: String) async throws -> FilesReadResult
    func quickOpen(workspaceId: Id, query: String, limit: Int) async throws -> [QuickOpenHit]
}

public struct EngineFilesBackend: FilesBackend {
    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func repos(workspaceId: Id) async throws -> [Repo] {
        try await client.request(Methods.RepoList.self, RepoListParams(workspaceId: workspaceId)).repos
    }

    public func list(repoId: Id, directory: String) async throws -> [FileEntry] {
        try await client.request(Methods.FilesList.self, FilesListParams(repoId: repoId, directory: directory)).entries
    }

    public func read(repoId: Id, path: String) async throws -> FilesReadResult {
        try await client.request(Methods.FilesRead.self, FilesReadParams(repoId: repoId, path: path))
    }

    public func quickOpen(workspaceId: Id, query: String, limit: Int) async throws -> [QuickOpenHit] {
        try await client.request(
            Methods.FilesQuickOpen.self, FilesQuickOpenParams(workspaceId: workspaceId, query: query, limit: limit)
        ).hits
    }
}
