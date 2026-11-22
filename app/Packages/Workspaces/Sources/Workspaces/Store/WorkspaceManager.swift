import Foundation
import Observation
import PicaProtocol

/// The app's workspace management (docs/workspaces.md): which sheet is open, each workspace's store, and creating a
/// workspace. The app target owns one and runs the registry's workspace actions through it (A-14).
@MainActor
@Observable
public final class WorkspaceManager {
    public enum Sheet: Identifiable, Equatable, Sendable {
        case newWorkspace
        case addRepository(workspaceId: Id)
        case importTeams(workspaceId: Id)
        case newSession(workspaceId: Id)
        case renameWorkspace(workspaceId: Id)

        public var id: String {
            switch self {
            case .newWorkspace: "newWorkspace"
            case .addRepository(let workspaceId): "addRepository.\(workspaceId)"
            case .importTeams(let workspaceId): "importTeams.\(workspaceId)"
            case .newSession(let workspaceId): "newSession.\(workspaceId)"
            case .renameWorkspace(let workspaceId): "renameWorkspace.\(workspaceId)"
            }
        }
    }

    public var sheet: Sheet?
    public private(set) var createProblem: WorkspaceProblem?
    public private(set) var isCreating = false

    @ObservationIgnored public let backend: any WorkspacesBackend
    @ObservationIgnored public let fixes: FixPerformer
    /// Set by the app target: selects a workspace once it is created.
    @ObservationIgnored public var onCreated: @MainActor (Workspace) -> Void = { _ in }
    /// Set by the app target: opens the Settings window, for a fix that asks for it.
    @ObservationIgnored public var openSettings: @MainActor () -> Void = {}
    /// Set by the app target: the workspace's repos as the sidebar's store holds them.
    @ObservationIgnored public var repos: @MainActor (Id) -> [Repo] = { _ in [] }
    /// Set by the app target: selects and opens a session once New Session has started it.
    @ObservationIgnored public var onSessionCreated: @MainActor (Session) -> Void = { _ in }
    /// Set by the app target: every workspace the sidebar's store holds, to check a new name against.
    @ObservationIgnored public var workspaces: @MainActor () -> [Workspace] = { [] }
    /// Set by the app target: the workspace's sessions as the sidebar's store holds them.
    @ObservationIgnored public var sessions: @MainActor (Id) -> [Session] = { _ in [] }
    /// Set by the app target: drops the workspace from the sidebar and moves the selection, before its
    /// `workspace.deleted` arrives.
    @ObservationIgnored public var onDeleted: @MainActor (Id) -> Void = { _ in }
    @ObservationIgnored private var stores: [Id: WorkspaceStore] = [:]

    public init(backend: any WorkspacesBackend, fixes: FixPerformer) {
        self.backend = backend
        self.fixes = fixes
    }

    /// The same store each time for a workspace, so its sync status outlives the view showing it.
    public func store(for workspaceId: Id) -> WorkspaceStore {
        if let store = stores[workspaceId] { return store }
        let store = WorkspaceStore(workspaceId: workspaceId, backend: backend)
        stores[workspaceId] = store
        return store
    }

    public func presentNewWorkspace() {
        createProblem = nil
        sheet = .newWorkspace
    }

    public func presentAddRepository(workspaceId: Id) {
        store(for: workspaceId).clearAddProblem()
        sheet = .addRepository(workspaceId: workspaceId)
    }

    public func presentTeamBrowser(workspaceId: Id) {
        sheet = .importTeams(workspaceId: workspaceId)
    }

    /// A fresh New Session sheet each time, so an earlier choice or problem does not linger.
    public private(set) var newSession: NewSessionStore?

    public func presentNewSession(workspaceId: Id) {
        newSession = NewSessionStore(workspaceId: workspaceId, backend: backend)
        sheet = .newSession(workspaceId: workspaceId)
    }

    /// Why New Session is off for this workspace, or nil when it can open.
    public func newSessionUnavailableReason(workspaceId: Id?) -> String? {
        NewSessionStore.unavailableReason(workspaceId: workspaceId, repos: workspaceId.map(repos) ?? [])
    }

    /// Starts the sheet's session and hands it on; returns whether it started.
    @discardableResult
    public func startSession() async -> Bool {
        guard let store = newSession else { return false }
        guard let session = await store.start(repos: repos(store.workspaceId)) else { return false }
        onSessionCreated(session)
        return true
    }

    public func sync(workspaceId: Id) {
        let store = store(for: workspaceId)
        Task { await store.syncNow() }
    }

    /// Returns whether the workspace was created; on failure `createProblem` says why.
    @discardableResult
    public func createWorkspace(named name: String) async -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isCreating else { return false }
        isCreating = true
        defer { isCreating = false }
        do {
            let workspace = try await backend.createWorkspace(name: trimmed)
            createProblem = nil
            onCreated(workspace)
            return true
        } catch {
            createProblem = WorkspaceProblem(error)
            return false
        }
    }

    // MARK: - Renaming

    public private(set) var renameProblem: WorkspaceProblem?
    public private(set) var isRenaming = false

    public func presentRename(workspaceId: Id) {
        guard workspaces().contains(where: { $0.id == workspaceId }) else { return }
        renameProblem = nil
        sheet = .renameWorkspace(workspaceId: workspaceId)
    }

    public func workspace(_ id: Id) -> Workspace? {
        workspaces().first { $0.id == id }
    }

    /// Why the name cannot be used for this workspace, or nil.
    public func nameProblem(_ name: String, renaming workspaceId: Id) -> String? {
        WorkspaceNaming.problem(for: name, renaming: workspaceId, among: workspaces())
    }

    /// Returns whether the sheet can close: the workspace was renamed, or kept its name. On failure `renameProblem`
    /// says why.
    @discardableResult
    public func renameWorkspace(_ workspaceId: Id, to name: String) async -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard nameProblem(trimmed, renaming: workspaceId) == nil, !isRenaming else { return false }
        if workspace(workspaceId)?.name == trimmed { return true }
        isRenaming = true
        defer { isRenaming = false }
        do {
            _ = try await backend.renameWorkspace(workspaceId, to: trimmed)
            renameProblem = nil
            return true
        } catch {
            renameProblem = WorkspaceProblem(error)
            return false
        }
    }

    // MARK: - Deleting

    /// The deletion waiting for the user to confirm it, which the confirmation shows.
    public var pendingDeletion: WorkspaceDeletion?
    /// The last deletion the engine refused or that failed.
    public var deleteProblem: WorkspaceProblem?
    public private(set) var isDeleting = false

    public func requestDelete(workspaceId: Id) {
        guard let workspace = workspace(workspaceId) else { return }
        deleteProblem = nil
        pendingDeletion = WorkspaceDeletion(workspace: workspace, repos: repos(workspaceId), sessions: sessions(workspaceId))
    }

    /// Deletes the workspace the user confirmed; returns whether it was deleted. On failure `deleteProblem` says why.
    /// The alert has already cleared `pendingDeletion` when its button runs this, so the deletion is passed in.
    @discardableResult
    public func confirmDelete(_ deletion: WorkspaceDeletion) async -> Bool {
        guard !deletion.isBlocked, !isDeleting else { return false }
        pendingDeletion = nil
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await backend.deleteWorkspace(deletion.workspace.id)
            stores[deletion.workspace.id] = nil
            if case .renameWorkspace(deletion.workspace.id) = sheet { sheet = nil }
            onDeleted(deletion.workspace.id)
            return true
        } catch {
            deleteProblem = WorkspaceProblem(error)
            return false
        }
    }
}
