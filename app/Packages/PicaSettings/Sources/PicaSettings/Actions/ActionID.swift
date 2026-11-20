/// Every command a user can run from a menu, the ⌘K palette or a shortcut (docs/settings.md). The app target performs
/// them with one exhaustive `switch`, so an action cannot be added without a way to run it. The raw value is the id
/// `keybindings` in config.jsonc uses.
public enum ActionID: String, CaseIterable, Sendable, Codable {
    case showCommandPalette
    case openSettings
    case openKeybindings
    case toggleSidebar
    case toggleInspector
    case selectNextSession
    case selectPreviousSession
    case showMcpServers
}

/// Where an action's menu item is.
public enum ActionMenu: Sendable {
    case app
    case view
    case window
}

public struct ActionDefinition: Identifiable, Hashable, Sendable {
    public let id: ActionID
    public let title: String
    public let menu: ActionMenu
    public let defaultShortcut: Shortcut?
    /// Other words the palette matches.
    public let keywords: [String]

    public init(id: ActionID, title: String, menu: ActionMenu, defaultShortcut: Shortcut?, keywords: [String] = []) {
        self.id = id
        self.title = title
        self.menu = menu
        self.defaultShortcut = defaultShortcut
        self.keywords = keywords
    }
}

/// The action registry: what each action is called, where its menu item is, and its default shortcut.
public enum ActionCatalog {
    public static let all: [ActionDefinition] = ActionID.allCases.map(definition)

    public static func definition(_ id: ActionID) -> ActionDefinition {
        switch id {
        case .showCommandPalette:
            ActionDefinition(id: id, title: "Show Command Palette", menu: .view, defaultShortcut: Shortcut("cmd+k"),
                keywords: ["commands", "actions"])
        case .openSettings:
            ActionDefinition(id: id, title: "Settings…", menu: .app, defaultShortcut: Shortcut("cmd+,"),
                keywords: ["preferences", "config"])
        case .openKeybindings:
            ActionDefinition(id: id, title: "Keyboard Shortcuts…", menu: .app, defaultShortcut: nil,
                keywords: ["keybindings", "keys", "shortcuts"])
        case .toggleSidebar:
            ActionDefinition(id: id, title: "Toggle Sidebar", menu: .view, defaultShortcut: Shortcut("cmd+ctrl+s"),
                keywords: ["hide", "show"])
        case .toggleInspector:
            ActionDefinition(id: id, title: "Toggle Inspector", menu: .view, defaultShortcut: Shortcut("cmd+alt+i"),
                keywords: ["hide", "show"])
        case .selectNextSession:
            ActionDefinition(id: id, title: "Select Next Session", menu: .window, defaultShortcut: Shortcut("cmd+alt+down"),
                keywords: ["go"])
        case .selectPreviousSession:
            ActionDefinition(id: id, title: "Select Previous Session", menu: .window, defaultShortcut: Shortcut("cmd+alt+up"),
                keywords: ["go"])
        case .showMcpServers:
            ActionDefinition(id: id, title: "MCP Servers", menu: .window, defaultShortcut: Shortcut("cmd+shift+m"),
                keywords: ["mcp", "tools", "servers", "presets", "import"])
        }
    }
}
