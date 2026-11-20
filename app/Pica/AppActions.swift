import AppKit
import AppShell
import EngineClient
import PicaProtocol
import PicaSettings
import SwiftUI
import Usage
import Workspaces

/// The action registry's handlers and the stores Settings and the ⌘K palette use (A-14, docs/settings.md). Features
/// meet here, in the app target: each action is run by the feature it belongs to.
@MainActor
final class AppActions {
    let keybindings: KeybindingStore
    let settings: SettingsStore
    let settingsNavigation = SettingsNavigation()
    /// Workspace and repo management (A-12).
    let workspaces: WorkspaceManager
    private(set) var registry: ActionRegistry!
    private(set) var palette: CommandPaletteModel!
    /// Set by the main window, which has the `openSettings` action.
    var openSettings: (() -> Void)?
    /// Set by the main window, which has the `openWindow` action (A-11).
    var openUsage: (() -> Void)?
    private let navigation: NavigationStore

    init(client: EngineClient, navigation: NavigationStore) {
        self.navigation = navigation
        let backend = EngineConfigBackend(client: client)
        keybindings = KeybindingStore(backend: backend)
        settings = SettingsStore(backend: backend)
        workspaces = WorkspaceManager(
            backend: EngineWorkspacesBackend(client: client),
            fixes: FixPerformer.system(environment: ProcessInfo.processInfo.environment))
        registry = ActionRegistry { [unowned self] id in perform(id) }
        palette = CommandPaletteModel(registry: registry) { [unowned self] in sessionItems() }
        keybindings.start(client: client)
        workspaces.onCreated = { [unowned navigation] workspace in navigation.select(.workspace(workspace.id)) }
        workspaces.openSettings = { [unowned self] in perform(.openSettings) }
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

    /// Each session in the sidebar, to go to from the palette.
    private func sessionItems() -> [PaletteItem] {
        navigation.sidebar.flatMap { workspace in
            workspace.sessions.map { session in
                PaletteItem(
                    target: .other("session.\(session.id)"), title: "Go to \(session.displayTitle)",
                    subtitle: workspace.workspace.name, keywords: ["session"])
            }
        }
    }

    func runPaletteItem(_ id: String) {
        guard id.hasPrefix("session.") else { return }
        navigation.select(.session(String(id.dropFirst("session.".count))))
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
                actions.openUsage = { openWindow(id: UsageDashboardScreen.windowId) }
            }
            .sheet(isPresented: $palette.isPresented) {
                CommandPaletteView(
                    model: actions.palette, registry: actions.registry, keybindings: actions.keybindings,
                    runOther: actions.runPaletteItem)
            }
    }
}
