import EngineClient
import Foundation
import Observation
import PicaProtocol

/// The sidebar's workspaces, repos and sessions as the engine reports them, and the window's navigation state
/// (EngineClient → store → view, PLAN.md §8). Specified in docs/navigation-shell.md.
@Observable @MainActor
public final class NavigationStore {
    public private(set) var workspaces: [Workspace] = []
    public private(set) var reposByWorkspace: [Id: [Repo]] = [:]
    public private(set) var sessionsById: [Id: Session] = [:]
    /// The last request that failed while loading, shown under the sidebar.
    public private(set) var loadFailure: String?
    public private(set) var hasLoaded = false

    public var selection: SidebarItem? {
        didSet { if selection != oldValue { scheduleSave() } }
    }
    public var isInspectorPresented: Bool {
        didSet { if isInspectorPresented != oldValue { scheduleSave() } }
    }
    public var collapsedWorkspaceIds: Set<Id> {
        didSet { if collapsedWorkspaceIds != oldValue { scheduleSave() } }
    }

    /// The inspector's width when the window opened; it starts at this and then belongs to the user.
    @ObservationIgnored public let restoredInspectorWidth: Double?
    /// The inspector's width now, as the view measures it.
    @ObservationIgnored public var inspectorWidth: Double? {
        didSet { if inspectorWidth != oldValue { scheduleSave() } }
    }

    @ObservationIgnored let client: EngineClient
    @ObservationIgnored private let stateFile: WindowStateFile?
    @ObservationIgnored private let clock: any Clock<Duration>
    @ObservationIgnored private var following: Task<Void, Never>?
    @ObservationIgnored private var pendingSave: Task<Void, Never>?
    /// Counts engine notifications, so a reload that started before one does not undo it.
    @ObservationIgnored private var changeCount = 0
    @ObservationIgnored private var workspaceChangedAt: [Id: Int] = [:]
    @ObservationIgnored private var sessionChangedAt: [Id: Int] = [:]
    @ObservationIgnored private var workspaceDeletedAt: [Id: Int] = [:]

    public init(client: EngineClient, stateFile: WindowStateFile?, clock: any Clock<Duration> = ContinuousClock()) {
        self.client = client
        self.stateFile = stateFile
        self.clock = clock
        let restored = stateFile?.load() ?? WindowState()
        selection = restored.selection
        isInspectorPresented = restored.isInspectorPresented
        collapsedWorkspaceIds = restored.collapsedWorkspaceIds
        restoredInspectorWidth = restored.inspectorWidth
        inspectorWidth = restored.inspectorWidth
    }

    // MARK: - What the sidebar shows

    public var sidebar: [SidebarWorkspace] {
        workspaces.map { workspace in
            SidebarWorkspace(
                workspace: workspace,
                repos: reposByWorkspace[workspace.id] ?? [],
                sessions: SessionOrdering.sorted(sessionsById.values.filter { $0.workspaceId == workspace.id }))
        }
    }

    /// The sessions ⌘1–9 select, in sidebar order.
    public var numberedSessions: [Session] {
        Array(sidebar.flatMap(\.sessions).prefix(9))
    }

    public func isExpanded(_ workspaceId: Id) -> Bool {
        !collapsedWorkspaceIds.contains(workspaceId)
    }

    public func setExpanded(_ expanded: Bool, workspaceId: Id) {
        if expanded {
            collapsedWorkspaceIds.remove(workspaceId)
        } else {
            collapsedWorkspaceIds.insert(workspaceId)
        }
    }

    /// Selects `item`, expanding its workspace so the row is visible.
    public func select(_ item: SidebarItem) {
        if let workspaceId = workspaceId(of: item) {
            setExpanded(true, workspaceId: workspaceId)
        }
        selection = item
    }

    /// Selects the session `offset` rows after the selected one in sidebar order, wrapping around; the first session
    /// when none is selected.
    public func selectSession(offset: Int) {
        let sessions = sidebar.flatMap(\.sessions)
        guard !sessions.isEmpty else { return }
        let current: Int? = if case .session(let id) = selection { sessions.firstIndex { $0.id == id } } else { nil }
        let next = current.map { ($0 + offset % sessions.count + sessions.count) % sessions.count } ?? 0
        select(.session(sessions[next].id))
    }

    /// A session this app just created: holds it as if `session.changed` had reported it, and selects it so the
    /// session column opens its timeline and composer.
    public func sessionCreated(_ session: Session) {
        if sessionsById[session.id] == nil {
            sessionChanged(session)
        }
        select(.session(session.id))
    }

    public func workspaceId(of item: SidebarItem) -> Id? {
        switch item {
        case .workspace(let id): id
        case .repo(let workspaceId, _): workspaceId
        case .session(let id): sessionsById[id]?.workspaceId
        }
    }

    public func workspace(_ id: Id) -> Workspace? {
        workspaces.first { $0.id == id }
    }

    public func repo(_ repoId: Id, in workspaceId: Id) -> Repo? {
        reposByWorkspace[workspaceId]?.first { $0.id == repoId }
    }

    public func contains(_ item: SidebarItem) -> Bool {
        switch item {
        case .workspace(let id): workspace(id) != nil
        case .repo(let workspaceId, let repoId): repo(repoId, in: workspaceId) != nil
        case .session(let id): sessionsById[id] != nil
        }
    }

    // MARK: - Following the engine

    /// Loads everything on each connection and applies `workspace.changed`, `workspace.deleted` and `session.changed`.
    /// Calling it again does nothing.
    public func start() {
        guard following == nil else { return }
        let client = client
        following = Task {
            // Listen before the first load, so no change between the load and the listening is missed.
            let workspaceChanges = await client.notifications(Notifications.WorkspaceChanged.self)
            let sessionChanges = await client.notifications(Notifications.SessionChanged.self)
            let workspaceDeletions = await client.notifications(Notifications.WorkspaceDeleted.self)
            let states = await client.connectionStates()
            await withDiscardingTaskGroup { group in
                group.addTask {
                    for await change in workspaceChanges { await self.workspaceChanged(change.workspace) }
                }
                group.addTask {
                    for await change in sessionChanges { await self.sessionChanged(change.session) }
                }
                group.addTask {
                    for await deletion in workspaceDeletions { await self.workspaceDeleted(deletion.id) }
                }
                group.addTask {
                    for await state in states {
                        if case .connected = state { await self.reload() }
                    }
                }
            }
        }
    }

    public func stop() {
        following?.cancel()
        following = nil
    }

    func reload() async {
        let startedAt = changeCount
        do {
            let listed = try await client.request(Methods.WorkspaceList.self).workspaces
            var repos: [Id: [Repo]] = [:]
            for workspace in listed {
                repos[workspace.id] = try await client.request(
                    Methods.RepoList.self, RepoListParams(workspaceId: workspace.id)).repos
            }
            let sessions = try await client.request(Methods.SessionList.self, SessionListParams()).sessions
            apply(workspaces: listed, repos: repos, sessions: sessions, changesSince: startedAt)
            loadFailure = nil
        } catch {
            loadFailure = Self.describe(error)
        }
    }

    /// Replaces what the store holds, keeping whatever a notification changed after the reload started.
    private func apply(workspaces listed: [Workspace], repos: [Id: [Repo]], sessions: [Session], changesSince startedAt: Int) {
        let newer = Set(workspaceChangedAt.filter { $0.value > startedAt }.keys)
        let deleted = Set(workspaceDeletedAt.filter { $0.value > startedAt }.keys)
        var merged = listed.filter { !deleted.contains($0.id) }.map { listedWorkspace in
            newer.contains(listedWorkspace.id) ? (workspace(listedWorkspace.id) ?? listedWorkspace) : listedWorkspace
        }
        merged += workspaces.filter { newer.contains($0.id) && !listed.map(\.id).contains($0.id) }
        var mergedRepos = repos
        for id in newer { mergedRepos[id] = reposByWorkspace[id] ?? repos[id] }
        var mergedSessions = Dictionary(
            sessions.filter { !deleted.contains($0.workspaceId) }.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        for (id, changedAt) in sessionChangedAt where changedAt > startedAt {
            mergedSessions[id] = sessionsById[id]
        }
        workspaces = merged
        for id in deleted { mergedRepos[id] = nil }
        reposByWorkspace = mergedRepos
        sessionsById = mergedSessions
        hasLoaded = true
        if let selection, !contains(selection) {
            self.selection = nil
        }
    }

    func workspaceChanged(_ changed: Workspace) async {
        changeCount += 1
        workspaceChangedAt[changed.id] = changeCount
        if let index = workspaces.firstIndex(where: { $0.id == changed.id }) {
            workspaces[index] = changed
        } else {
            workspaces.append(changed)
        }
        // Pinning, unpinning and syncing change which repos the workspace has.
        do {
            let repos = try await client.request(Methods.RepoList.self, RepoListParams(workspaceId: changed.id)).repos
            if workspace(changed.id) != nil { reposByWorkspace[changed.id] = repos }
        } catch {
            loadFailure = Self.describe(error)
        }
    }

    /// The workspace is gone with its sessions (`workspace.deleted`, or this app's own `workspace.delete`). A selection
    /// in it moves to the next workspace in the sidebar, else the previous one, else to nothing. Repeating it does
    /// nothing.
    public func workspaceDeleted(_ id: Id) {
        changeCount += 1
        workspaceDeletedAt[id] = changeCount
        guard let index = workspaces.firstIndex(where: { $0.id == id }) else { return }
        let selected = selection.flatMap(workspaceId(of:)) == id
        workspaces.remove(at: index)
        reposByWorkspace[id] = nil
        sessionsById = sessionsById.filter { $0.value.workspaceId != id }
        collapsedWorkspaceIds.remove(id)
        if selected {
            let neighbour = index < workspaces.count ? workspaces[index] : workspaces.last
            selection = neighbour.map { .workspace($0.id) }
        }
    }

    func sessionChanged(_ changed: Session) {
        // Deleting a workspace ends its idle sessions first; their `session.changed` can arrive after the deletion.
        guard workspaceDeletedAt[changed.workspaceId] == nil else { return }
        changeCount += 1
        sessionChangedAt[changed.id] = changeCount
        sessionsById[changed.id] = changed
    }

    private static func describe(_ error: any Error) -> String {
        if let clientError = error as? EngineClientError, let code = clientError.code {
            return "\(code.rawValue): \(clientError)"
        }
        return String(describing: error)
    }

    // MARK: - Window restoration

    public var windowState: WindowState {
        var state = WindowState()
        state.selection = selection
        state.inspectorWidth = inspectorWidth
        state.isInspectorPresented = isInspectorPresented
        state.collapsedWorkspaceIds = collapsedWorkspaceIds
        return state
    }

    /// Writes the window state now; called on quit, and shortly after each change.
    public func saveNow() {
        pendingSave?.cancel()
        pendingSave = nil
        try? stateFile?.save(windowState)
    }

    /// Dragging a divider reports many widths; they are written once it settles.
    private func scheduleSave() {
        guard stateFile != nil else { return }
        pendingSave?.cancel()
        let clock = clock
        pendingSave = Task {
            do {
                try await clock.sleep(for: .milliseconds(250))
            } catch {
                return
            }
            self.saveNow()
        }
    }
}
