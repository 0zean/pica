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

        public var id: String {
            switch self {
            case .newWorkspace: "newWorkspace"
            case .addRepository(let workspaceId): "addRepository.\(workspaceId)"
            case .importTeams(let workspaceId): "importTeams.\(workspaceId)"
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
}
