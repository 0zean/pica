import PicaProtocol

/// One config.jsonc key the General pane edits.
public struct SettingsField: Identifiable, Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        /// One of fixed values, with what to call each.
        case choice([Choice])
        /// `auto` or a model from `models.list`.
        case tier
        /// A number of credits, zero or more.
        case credits
    }

    public struct Choice: Hashable, Sendable {
        public let value: String
        public let title: String
    }

    public let keyPath: String
    public let title: String
    public let help: String
    public let kind: Kind
    public var id: String { keyPath }

    public static let routing: [SettingsField] = [
        SettingsField(
            keyPath: "routing.profile", title: "Routing profile",
            help: "How new sessions route work to cheaper agents. A workspace's own setting wins.",
            kind: .choice([
                Choice(value: "off", title: "Off"), Choice(value: "balanced", title: "Balanced"),
                Choice(value: "strict", title: "Strict"),
            ])),
        SettingsField(keyPath: "routing.tiers.reasoning", title: "Reasoning tier", help: "The main agent's model.", kind: .tier),
        SettingsField(keyPath: "routing.tiers.worker", title: "Worker tier", help: "The model sub-agents run on.", kind: .tier),
    ]

    public static let budget: [SettingsField] = [
        SettingsField(keyPath: "budget.sessionCredits", title: "Credits per session", help: "A session asks before going past this.", kind: .credits),
        SettingsField(
            keyPath: "budget.workspaceDailyCredits", title: "Credits per workspace per day",
            help: "All of a workspace's sessions on one day.", kind: .credits),
    ]

    public static let permissions: [SettingsField] = [
        SettingsField(
            keyPath: "permissions.mode", title: "Permission mode", help: "Ask before tools that write, or let them run.",
            kind: .choice([Choice(value: "ask", title: "Ask"), Choice(value: "auto", title: "Auto")])),
    ]

    public static let all = routing + budget + permissions
}
