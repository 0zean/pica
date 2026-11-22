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

        public var id: String {
            switch self {
            case .newWorkspace: "newWorkspace"
            case .addRepository(let workspaceId): "addRepository.\(workspaceId)"
            case .importTeams(let workspaceId): "importTeams.\(workspaceId)"
            case .newSession(let workspaceId): "newSession.\(workspaceId)"
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
}
