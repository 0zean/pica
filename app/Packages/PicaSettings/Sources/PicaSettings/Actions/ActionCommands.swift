import SwiftUI

/// The registry's menu items, each with its current shortcut. Replaces the system's Settings and sidebar items so
/// those shortcuts can be rebound too.
public struct ActionCommands: Commands {
    private let registry: ActionRegistry
    private let keybindings: KeybindingStore

    public init(registry: ActionRegistry, keybindings: KeybindingStore) {
        self.registry = registry
        self.keybindings = keybindings
    }

    public var body: some Commands {
        CommandGroup(replacing: .appSettings) { items(.app) }
        CommandGroup(before: .newItem) {
            items(.file)
            Divider()
        }
        CommandGroup(replacing: .sidebar) { items(.view) }
        CommandGroup(before: .windowList) {
            items(.window)
            Divider()
        }
    }

    private func items(_ menu: ActionMenu) -> some View {
        ForEach(registry.definitions.filter { $0.menu == menu }) { definition in
            Button(definition.title) { registry.perform(definition.id) }
                .keyboardShortcut(keybindings.shortcut(for: definition.id)?.keyboardShortcut)
        }
    }
}
