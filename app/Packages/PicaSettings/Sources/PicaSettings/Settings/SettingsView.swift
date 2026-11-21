import SwiftUI

/// Which pane Settings shows; `openKeybindings` opens it on Keyboard.
@Observable @MainActor
public final class SettingsNavigation {
    public enum Pane: Hashable, Sendable {
        case general
        case appearance
        case keyboard
    }

    public var pane: Pane = .general

    public init() {}
}

/// The Settings scene's content: General (config.jsonc keys), Appearance (theme, density and accent, X-01) and
/// Keyboard (the keybinding editor).
public struct SettingsView: View {
    @Bindable private var navigation: SettingsNavigation
    private let settings: SettingsStore
    private let keybindings: KeybindingStore
    private let registry: ActionRegistry
    private let appearance: AppearanceStore

    public init(
        navigation: SettingsNavigation, settings: SettingsStore, appearance: AppearanceStore, keybindings: KeybindingStore,
        registry: ActionRegistry
    ) {
        self.navigation = navigation
        self.settings = settings
        self.appearance = appearance
        self.keybindings = keybindings
        self.registry = registry
    }

    public var body: some View {
        TabView(selection: $navigation.pane) {
            Tab("General", systemImage: "gearshape", value: SettingsNavigation.Pane.general) {
                GeneralSettingsView(store: settings)
            }
            Tab("Appearance", systemImage: "paintpalette", value: SettingsNavigation.Pane.appearance) {
                AppearanceSettingsView(store: appearance)
            }
            Tab("Keyboard", systemImage: "keyboard", value: SettingsNavigation.Pane.keyboard) {
                KeybindingsView(store: keybindings, registry: registry)
            }
        }
        .frame(width: 560, height: 480)
        .accessibilityIdentifier("pica.settings")
    }
}
