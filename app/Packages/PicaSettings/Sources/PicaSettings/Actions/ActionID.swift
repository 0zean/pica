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
    case newSession
    case newWorkspace
    case addRepository
    case importTeams
    case syncWorkspace
    case showUsage
    case showSessionOverview
    case showCustomization
}

/// Where an action's menu item is.
public enum ActionMenu: Sendable {
    case app
    case file
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
        case .newSession:
            ActionDefinition(id: id, title: "New Session…", menu: .file, defaultShortcut: Shortcut("cmd+n"),
                keywords: ["start", "create", "prompt", "chat", "agent"])
        case .newWorkspace:
            ActionDefinition(id: id, title: "New Workspace…", menu: .file, defaultShortcut: Shortcut("cmd+shift+n"),
                keywords: ["create"])
        case .addRepository:
            ActionDefinition(id: id, title: "Add Repository…", menu: .file, defaultShortcut: nil,
                keywords: ["repo", "clone", "folder", "url"])
        case .importTeams:
            ActionDefinition(id: id, title: "Import GitHub Teams…", menu: .file, defaultShortcut: nil,
                keywords: ["team", "github", "repos"])
        case .syncWorkspace:
            ActionDefinition(id: id, title: "Sync Workspace", menu: .file, defaultShortcut: nil,
                keywords: ["refresh", "github", "team"])
        case .showUsage:
            ActionDefinition(id: id, title: "Usage Dashboard", menu: .window, defaultShortcut: Shortcut("shift+cmd+u"),
                keywords: ["cost", "credits", "tokens", "budget", "savings"])
        case .showSessionOverview:
            ActionDefinition(id: id, title: "Session Overview", menu: .window, defaultShortcut: Shortcut("shift+cmd+o"),
                keywords: ["board", "sessions", "attention", "approvals", "fan-out", "fanout"])
        case .showCustomization:
            ActionDefinition(id: id, title: "Agents & Skills", menu: .window, defaultShortcut: Shortcut("cmd+shift+a"),
                keywords: ["agents", "skills", "rules", "instructions", "AGENTS.md", "prompts"])
        }
    }
}
