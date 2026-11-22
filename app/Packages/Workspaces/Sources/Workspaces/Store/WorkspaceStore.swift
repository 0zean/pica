import Foundation
import Observation
import PicaProtocol

/// One workspace's management (docs/workspaces.md): adding a repo by path or URL, syncing its sources, and removing a
/// source. The workspace and its repos themselves come from the sidebar's store, which follows `workspace.changed`;
/// this store holds only what its own requests are doing.
@MainActor
@Observable
public final class WorkspaceStore {
    public enum SyncState: Equatable, Sendable {
        case idle
        case syncing
        case synced(added: Int, removed: Int)
        case failed(WorkspaceProblem)
    }

    public enum AddState: Equatable, Sendable {
        case idle
        case adding(RepoLocation)
        case failed(WorkspaceProblem)
    }

    public let workspaceId: Id
    public private(set) var sync: SyncState = .idle
    public private(set) var adding: AddState = .idle
    /// The last source removal that failed.
    public private(set) var sourceProblem: WorkspaceProblem?
    /// The last repo removal that failed, or whose clone could not be deleted.
    public private(set) var repoProblem: WorkspaceProblem?
    /// The repo being removed.
    public private(set) var removingRepoId: Id?

    @ObservationIgnored private let backend: any WorkspacesBackend

    public init(workspaceId: Id, backend: any WorkspacesBackend) {
        self.workspaceId = workspaceId
        self.backend = backend
    }

    public var isSyncing: Bool { sync == .syncing }

    public var isAdding: Bool {
        if case .adding = adding { return true }
        return false
    }

    /// Registers the folder in place, or clones the URL, and pins the repo to the workspace. Returns whether it was
    /// added; on failure `adding` holds the problem.
    @discardableResult
    public func addRepo(_ input: String) async -> Bool {
        guard let location = RepoLocation(input) else {
            adding = .failed(WorkspaceProblem(message: "Enter a folder path starting with / or ~, or a repository URL."))
            return false
        }
        guard !isAdding else { return false }
        adding = .adding(location)
        do {
            let repo = switch location {
            case .path(let path): try await backend.addRepo(path: path)
            case .url(let url): try await backend.addRepo(url: url)
            }
            try await backend.pin(repoId: repo.id, to: workspaceId)
            adding = .idle
            return true
        } catch {
            adding = .failed(WorkspaceProblem(error))
            return false
        }
    }

    public func clearAddProblem() {
        if case .failed = adding { adding = .idle }
    }

    /// Lists every source's repos on GitHub again; new repos arrive as available.
    public func syncNow() async {
        guard !isSyncing else { return }
        sync = .syncing
        await runSync()
    }

    /// Syncs after a source was added, when the caller already shows that work is under way.
    func syncAfterImport() async -> WorkspaceProblem? {
        sync = .syncing
        await runSync()
        if case .failed(let problem) = sync { return problem }
        return nil
    }

    private func runSync() async {
        do {
            let result = try await backend.sync(workspaceId: workspaceId)
            sync = .synced(added: result.added.count, removed: result.removed.count)
        } catch {
            sync = .failed(WorkspaceProblem(error))
        }
    }

    public func removeSource(_ source: RepoSource) async {
        do {
            try await backend.removeSource(source.id, from: workspaceId)
            sourceProblem = nil
        } catch {
            sourceProblem = WorkspaceProblem(error)
        }
    }

    /// Takes the repo out of the workspace (`workspace.removeRepo`) and, if asked, then forgets it and deletes its
    /// managed clone (`repo.remove` without force, refused with local work). Returns whether it left the workspace.
    @discardableResult
    public func removeRepo(_ removal: RepoRemoval, deletingClone: Bool) async -> Bool {
        guard removingRepoId == nil else { return false }
        removingRepoId = removal.repo.id
        defer { removingRepoId = nil }
        do {
            try await backend.removeRepo(removal.repo.id, from: workspaceId)
        } catch {
            repoProblem = WorkspaceProblem(error)
            return false
        }
        repoProblem = nil
        guard deletingClone, removal.canDeleteClone else { return true }
        do {
            try await backend.forgetRepo(removal.repo.id)
        } catch {
            var problem = WorkspaceProblem(error)
            problem.message = "Removed \(removal.name) from the workspace, but kept its clone: \(problem.message)"
            repoProblem = problem
        }
        return true
    }

    public func clearRepoProblem() {
        repoProblem = nil
    }
}
