import Foundation
import Observation
import PicaProtocol

/// The Files inspector's tree (docs/files.md): each workspace repo, whose directories load their children from the
/// engine when first expanded. `rows` is the tree flattened to what is visible.
@MainActor
@Observable
public final class FileTreeStore {
    public struct Row: Equatable, Identifiable, Sendable {
        public enum Kind: Equatable, Sendable {
            case repo
            case directory
            case file
        }

        public var repoId: Id
        /// Repo-relative; "" for the repo itself.
        public var path: String
        public var name: String
        public var kind: Kind
        public var depth: Int
        public var isExpanded: Bool

        public var id: String { "\(repoId):\(path)" }
    }

    public private(set) var rows: [Row] = []
    public private(set) var repos: [Repo] = []
    public private(set) var loadFailure: String?
    /// Directories whose children could not be listed, with the reason.
    public private(set) var failures: [String: String] = [:]

    @ObservationIgnored private let backend: any FilesBackend
    @ObservationIgnored private var children: [String: [FileEntry]] = [:]
    @ObservationIgnored private var expanded: Set<String> = []

    public init(backend: any FilesBackend) {
        self.backend = backend
    }

    public func load(workspaceId: Id) async {
        do {
            repos = try await backend.repos(workspaceId: workspaceId).sorted { $0.shortName < $1.shortName }
            loadFailure = nil
        } catch {
            repos = []
            loadFailure = error.localizedDescription
        }
        // One repo is opened at once, since there is nothing else to choose.
        if repos.count == 1, let repo = repos.first, expanded.isEmpty {
            await toggle(Row(repoId: repo.id, path: "", name: repo.shortName, kind: .repo, depth: 0, isExpanded: false))
        }
        rebuild()
    }

    /// Expands or collapses a repo or directory, listing its children the first time.
    public func toggle(_ row: Row) async {
        guard row.kind != .file else { return }
        if expanded.remove(row.id) != nil {
            rebuild()
            return
        }
        expanded.insert(row.id)
        if children[row.id] == nil {
            do {
                children[row.id] = try await backend.list(repoId: row.repoId, directory: row.path)
                failures[row.id] = nil
            } catch {
                failures[row.id] = error.localizedDescription
            }
        }
        rebuild()
    }

    public func reference(for row: Row) -> FileReference? {
        guard row.kind == .file, let repo = repos.first(where: { $0.id == row.repoId }) else { return nil }
        return FileReference(repoId: repo.id, repoName: repo.shortName, path: row.path, repoPath: repo.localPath)
    }

    private func rebuild() {
        var rows: [Row] = []
        for repo in repos {
            let row = Row(repoId: repo.id, path: "", name: repo.shortName, kind: .repo, depth: 0, isExpanded: expanded.contains("\(repo.id):"))
            rows.append(row)
            if row.isExpanded { appendChildren(of: row, to: &rows) }
        }
        self.rows = rows
    }

    private func appendChildren(of parent: Row, to rows: inout [Row]) {
        for entry in children[parent.id] ?? [] {
            let row = Row(
                repoId: entry.repoId, path: entry.path,
                name: entry.path.split(separator: "/").last.map(String.init) ?? entry.path,
                kind: entry.kind == .directory ? .directory : .file, depth: parent.depth + 1,
                isExpanded: expanded.contains("\(entry.repoId):\(entry.path)"))
            rows.append(row)
            if row.isExpanded { appendChildren(of: row, to: &rows) }
        }
    }
}
