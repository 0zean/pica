import AppKit
import DesignSystem
import AppShell
import Customization
import EngineClient
import McpServers
import PicaProtocol
import PicaSettings
import SessionOverview
import SwiftUI
import Usage
import Workspaces

/// The action registry's handlers and the stores Settings and the ⌘K palette use (A-14, docs/settings.md). Features
/// meet here, in the app target: each action is run by the feature it belongs to.
@MainActor
final class AppActions {
    let keybindings: KeybindingStore
    let settings: SettingsStore
    /// Theme, density and accent, applied to every window (X-01).
    let appearance: AppearanceStore
    let settingsNavigation = SettingsNavigation()
    /// Workspace and repo management (A-12).
    let workspaces: WorkspaceManager
    private(set) var registry: ActionRegistry!
    private(set) var palette: CommandPaletteModel!
    /// Set by the main window, which has the `openSettings` action.
    var openSettings: (() -> Void)?
    /// Set by the main window, which has the `openWindow` action (A-13).
    var openMcpServers: (() -> Void)?
    /// Set by the main window, which has the `openWindow` action (A-11).
    var openUsage: (() -> Void)?
    /// Set by the main window, which has the `openWindow` action (A-16).
    var openSessionOverview: (() -> Void)?
    /// Set by the main window, which has the `openWindow` action (X-02).
    var openCustomization: (() -> Void)?
    private let navigation: NavigationStore

    init(client: EngineClient, navigation: NavigationStore) {
        self.navigation = navigation
        let backend = EngineConfigBackend(client: client)
        keybindings = KeybindingStore(backend: backend)
        settings = SettingsStore(backend: backend)
        appearance = AppearanceStore(
            backend: backend, themesDirectory: ThemeLibrary.directory(environment: ProcessInfo.processInfo.environment))
        workspaces = WorkspaceManager(
            backend: EngineWorkspacesBackend(client: client),
            fixes: FixPerformer.system(environment: ProcessInfo.processInfo.environment))
        registry = ActionRegistry { [unowned self] id in perform(id) }
        palette = CommandPaletteModel(registry: registry) { [unowned self] in sessionItems() }
        keybindings.start(client: client)
        appearance.start(client: client)
        workspaces.onCreated = { [unowned navigation] workspace in navigation.select(.workspace(workspace.id)) }
        workspaces.openSettings = { [unowned self] in perform(.openSettings) }
        workspaces.repos = { [unowned navigation] id in navigation.reposByWorkspace[id] ?? [] }
        // The engine answers before its `session.changed` arrives, so the store takes the session now and the
        // selection has a row to land on.
        workspaces.onSessionCreated = { [unowned navigation] session in navigation.sessionCreated(session) }
    }

    private func perform(_ id: ActionID) {
        switch id {
        case .showCommandPalette:
            palette.present()
        case .openSettings:
            settingsNavigation.pane = .general
            openSettings?()
        case .openKeybindings:
            settingsNavigation.pane = .keyboard
            openSettings?()
        case .toggleSidebar:
            NSApp.sendAction(#selector(NSSplitViewController.toggleSidebar(_:)), to: nil, from: nil)
        case .toggleInspector:
            navigation.isInspectorPresented.toggle()
        case .selectNextSession:
            navigation.selectSession(offset: 1)
        case .selectPreviousSession:
            navigation.selectSession(offset: -1)
        case .showMcpServers:
            openMcpServers?()
        case .newSession:
            withTargetWorkspace { workspaces.presentNewSession(workspaceId: $0) }
        case .newWorkspace:
            workspaces.presentNewWorkspace()
        case .addRepository:
            withTargetWorkspace { workspaces.presentAddRepository(workspaceId: $0) }
        case .importTeams:
            withTargetWorkspace { workspaces.presentTeamBrowser(workspaceId: $0) }
        case .syncWorkspace:
            withTargetWorkspace { id in
                navigation.select(.workspace(id))
                workspaces.sync(workspaceId: id)
            }
        case .showUsage:
            openUsage?()
        case .showSessionOverview:
            openSessionOverview?()
        case .showCustomization:
            openCustomization?()
        case .renameSession:
            if let session = navigation.selectedSession { navigation.beginRename(session.id) }
        case .deleteSession:
            if let session = navigation.selectedSession { navigation.beginDelete(session.id) }
        }
    }

    /// The workspace the sidebar's selection is in, else the only workspace there is.
    func targetWorkspaceId() -> Id? {
        navigation.selection.flatMap(navigation.workspaceId(of:))
            ?? (navigation.workspaces.count == 1 ? navigation.workspaces.first?.id : nil)
    }

    /// With no workspace to act on, a new one is the way forward.
    private func withTargetWorkspace(_ body: (Id) -> Void) {
        if let id = targetWorkspaceId() {
            body(id)
        } else {
            workspaces.presentNewWorkspace()
        }
    }

    /// Each session in the sidebar, to go to, rename or delete from the palette.
    private func sessionItems() -> [PaletteItem] {
        navigation.sidebar.flatMap { workspace in
            workspace.sessions.flatMap { session in
                [
                    PaletteItem(
                        target: .other("session.\(session.id)"), title: "Go to \(session.displayTitle)",
                        subtitle: workspace.workspace.name, keywords: ["session"]),
                    PaletteItem(
                        target: .other("rename-session.\(session.id)"), title: "Rename \(session.displayTitle)…",
                        subtitle: workspace.workspace.name, keywords: ["session", "title"]),
                    PaletteItem(
                        target: .other("delete-session.\(session.id)"), title: "Delete \(session.displayTitle)…",
                        subtitle: workspace.workspace.name, keywords: ["session", "remove"]),
                ]
            }
        }
    }

    func runPaletteItem(_ id: String) {
        for (prefix, run) in [
            ("session.", { (id: Id) in self.navigation.select(.session(id)) }),
            ("rename-session.", { (id: Id) in self.navigation.beginRename(id) }),
            ("delete-session.", { (id: Id) in self.navigation.beginDelete(id) }),
        ] where id.hasPrefix(prefix) {
            run(String(id.dropFirst(prefix.count)))
            return
        }
    }
}

/// Gives `AppActions` the window's `openSettings` and `openWindow` actions, and shows the palette over the window.
struct ActionHost: ViewModifier {
    let actions: AppActions
    @Environment(\.openSettings) private var openSettings
    @Environment(\.openWindow) private var openWindow

    func body(content: Content) -> some View {
        @Bindable var palette = actions.palette
        content
            .onAppear {
                actions.openSettings = { openSettings() }
                actions.openMcpServers = { openWindow(id: McpServersScreen.windowId) }
                actions.openUsage = { openWindow(id: UsageDashboardScreen.windowId) }
                actions.openSessionOverview = { openWindow(id: SessionOverviewScreen.windowId) }
                actions.openCustomization = { openWindow(id: CustomizationScreen.windowId) }
            }
            .sheet(isPresented: $palette.isPresented) {
                CommandPaletteView(
                    model: actions.palette, registry: actions.registry, keybindings: actions.keybindings,
                    runOther: actions.runPaletteItem)
            }
    }
}

/// X-01: draws a window with the theme, density and accent from Settings ▸ Appearance (docs/themes.md).
struct AppearanceHost: ViewModifier {
    let store: AppearanceStore

    func body(content: Content) -> some View {
        content.picaAppearance(theme: store.theme, density: store.density)
    }
}
