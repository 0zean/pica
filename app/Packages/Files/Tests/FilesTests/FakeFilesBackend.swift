@testable import Files
import EngineClient
import Foundation
import PicaProtocol

/// Answers from fixed listings. Quick-open searches wait until `release()` while `holdSearches` is set, so a test can
/// type while one is out.
@MainActor
final class FakeFilesBackend: FilesBackend, @unchecked Sendable {
    var repoList: [Repo] = [
        .fixture(id: "r1", remoteUrl: "https://git.example.com/acme/atlas.git", localPath: "/work/atlas"),
        .fixture(id: "r2", remoteUrl: "https://git.example.com/acme/beacon.git", localPath: "/work/beacon"),
    ]
    var listings: [String: [FileEntry]] = [
        "r1:": [.directory("r1", "src"), .file("r1", "README.md")],
        "r1:src": [.file("r1", "src/main.swift")],
        "r2:": [.file("r2", "Package.swift")],
    ]
    var hits: [String: [QuickOpenHit]] = [:]
    var files: [String: FilesReadResult] = [:]
    private(set) var listed: [String] = []
    private(set) var queries: [String] = []
    var holdSearches = false
    private var held: [CheckedContinuation<Void, Never>] = []

    nonisolated func repos(workspaceId: Id) async throws -> [Repo] {
        await MainActor.run { repoList }
    }

    nonisolated func list(repoId: Id, directory: String) async throws -> [FileEntry] {
        try await MainActor.run {
            listed.append("\(repoId):\(directory)")
            guard let entries = listings["\(repoId):\(directory)"] else { throw EngineClientError.engine(.notFound) }
            return entries
        }
    }

    nonisolated func read(repoId: Id, path: String) async throws -> FilesReadResult {
        try await MainActor.run {
            guard let file = files["\(repoId):\(path)"] else { throw EngineClientError.engine(.binary) }
            return file
        }
    }

    nonisolated func quickOpen(workspaceId: Id, query: String, limit: Int) async throws -> [QuickOpenHit] {
        await MainActor.run { queries.append(query) }
        if await MainActor.run(body: { holdSearches && !query.isEmpty }) {
            await withCheckedContinuation { continuation in
                Task { @MainActor in held.append(continuation) }
            }
        }
        return await MainActor.run { hits[query] ?? [] }
    }

    func release() {
        let waiting = held
        held = []
        waiting.forEach { $0.resume() }
    }

    var heldCount: Int { held.count }
}

extension Repo {
    static func fixture(id: Id, remoteUrl: String?, localPath: String?) -> Repo {
        Repo(id: id, remoteUrl: remoteUrl, localPath: localPath, managed: false, defaultBranch: "main", cloneState: .cloned)
    }
}

extension FileEntry {
    static func file(_ repoId: Id, _ path: String) -> FileEntry {
        FileEntry(repoId: repoId, path: path, kind: .file, sizeBytes: 10)
    }

    static func directory(_ repoId: Id, _ path: String) -> FileEntry {
        FileEntry(repoId: repoId, path: path, kind: .directory, sizeBytes: nil)
    }
}

extension RpcError {
    static let notFound = RpcError(code: -32000, message: "not a directory", data: ErrorData(code: .notFound, details: ["reason": .string("files.not_found")]))
    static let binary = RpcError(code: -32000, message: "binary", data: ErrorData(code: .invalidState, details: ["reason": .string("files.binary")]))
}

@MainActor
func waitUntil(_ condition: @MainActor () -> Bool) async throws {
    for _ in 0..<200 where !condition() {
        try await Task.sleep(for: .milliseconds(5))
    }
}
