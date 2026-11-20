import AppKit
import AppShell
import EngineClient
import PicaProtocol
import PicaSettings
import SwiftUI
import Usage

/// The action registry's handlers and the stores Settings and the ⌘K palette use (A-14, docs/settings.md). Features
/// meet here, in the app target: each action is run by the feature it belongs to.
@MainActor
final class AppActions {
    let keybindings: KeybindingStore
    let settings: SettingsStore
    let settingsNavigation = SettingsNavigation()
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
        registry = ActionRegistry { [unowned self] id in perform(id) }
        palette = CommandPaletteModel(registry: registry) { [unowned self] in sessionItems() }
        keybindings.start(client: client)
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
        case .showUsage:
            openUsage?()
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
