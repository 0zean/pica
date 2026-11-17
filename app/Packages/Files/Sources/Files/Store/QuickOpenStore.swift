import Foundation
import Observation
import PicaProtocol

/// ⌘P (docs/files.md): searches the workspace's repos as the query changes. Each keystroke asks the engine at once,
/// with no delay; while a search is out, later keystrokes wait and only the newest query is sent next, so replies
/// never arrive out of order and a fast typist does not queue searches.
@MainActor
@Observable
public final class QuickOpenStore {
    public struct Row: Equatable, Identifiable, Sendable {
        public var reference: FileReference
        public var id: String { "\(reference.repoId):\(reference.path)" }
        /// The directory part of the path, shown after the name.
        public var directory: String {
            let parts = reference.path.split(separator: "/")
            return parts.dropLast().joined(separator: "/")
        }
    }

    public static let limit = 50

    public private(set) var query = ""
    public private(set) var rows: [Row] = []
    public private(set) var selected = 0
    /// Shown in place of rows: no workspace, nothing found, or the engine's error.
    public private(set) var message: String?
    /// The query the rows are for; behind `query` while a search is out.
    public private(set) var answeredQuery = ""

    @ObservationIgnored private let backend: any FilesBackend
    @ObservationIgnored private var workspaceId: Id?
    @ObservationIgnored private var repos: [Id: Repo] = [:]
    @ObservationIgnored private var searching = false
    @ObservationIgnored private var generation = 0

    public init(backend: any FilesBackend) {
        self.backend = backend
    }

    /// Starts over for `workspaceId`'s repos; the engine lists them so the first keystroke finds them listed.
    public func begin(workspaceId: Id?, repos: [Repo]) {
        generation += 1
        self.workspaceId = workspaceId
        self.repos = Dictionary(repos.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        query = ""
        answeredQuery = ""
        rows = []
        selected = 0
        searching = false
        message = workspaceId == nil ? "Select a workspace to search its files." : nil
        guard let workspaceId else { return }
        let backend = backend
        Task { _ = try? await backend.quickOpen(workspaceId: workspaceId, query: "", limit: 1) }
    }

    public func setQuery(_ query: String) {
        guard query != self.query else { return }
        self.query = query
        searchIfIdle()
    }

    public func moveSelection(by delta: Int) {
        guard !rows.isEmpty else { return }
        selected = (selected + delta + rows.count) % rows.count
    }

    public func select(_ row: Row) {
        selected = rows.firstIndex(of: row) ?? selected
    }

    public var selectedReference: FileReference? {
        rows.indices.contains(selected) ? rows[selected].reference : nil
    }

    private func searchIfIdle() {
        guard !searching, let workspaceId else { return }
        let query = query
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            show([], for: query)
            return
        }
        searching = true
        let started = generation
        let backend = backend
        Task {
            let outcome: Result<[QuickOpenHit], any Error>
            do {
                outcome = .success(try await backend.quickOpen(workspaceId: workspaceId, query: query, limit: Self.limit))
            } catch {
                outcome = .failure(error)
            }
            guard started == generation else { return }
            searching = false
            switch outcome {
            case .success(let hits): show(hits, for: query)
            case .failure(let error):
                rows = []
                answeredQuery = query
                message = "Search failed: \(FileViewerStore.describe(error))"
            }
            if self.query != query { searchIfIdle() }
        }
    }

    private func show(_ hits: [QuickOpenHit], for query: String) {
        let previous = selectedReference
        rows = hits.map { hit in
            let repo = repos[hit.repoId]
            return Row(reference: FileReference(
                repoId: hit.repoId, repoName: repo?.shortName ?? hit.repoId, path: hit.path, repoPath: repo?.localPath))
        }
        selected = previous.flatMap { reference in rows.firstIndex { $0.reference == reference } } ?? 0
        answeredQuery = query
        message = rows.isEmpty && !query.trimmingCharacters(in: .whitespaces).isEmpty ? "No files match “\(query)”." : nil
    }
}
