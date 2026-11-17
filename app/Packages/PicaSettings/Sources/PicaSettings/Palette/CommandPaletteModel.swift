import Observation

/// One row of the palette: an action from the registry, or an item the app adds (a session to go to).
public struct PaletteItem: Identifiable, Hashable, Sendable {
    public enum Target: Hashable, Sendable {
        case action(ActionID)
        case other(String)
    }

    public let target: Target
    public let title: String
    public let subtitle: String?
    public let keywords: [String]

    public init(target: Target, title: String, subtitle: String? = nil, keywords: [String] = []) {
        self.target = target
        self.title = title
        self.subtitle = subtitle
        self.keywords = keywords
    }

    public var id: String {
        switch target {
        case .action(let id): "action.\(id.rawValue)"
        case .other(let id): id
        }
    }
}

/// The ⌘K palette's query, the rows that match it, and the selected row.
@Observable @MainActor
public final class CommandPaletteModel {
    public var query = "" {
        didSet { if query != oldValue { selectedIndex = 0 } }
    }
    public private(set) var selectedIndex = 0
    public var isPresented = false

    @ObservationIgnored private let items: @MainActor () -> [PaletteItem]

    /// `extraItems` are asked for each time the palette filters, so they follow the sidebar.
    public init(registry: ActionRegistry, extraItems: @escaping @MainActor () -> [PaletteItem] = { [] }) {
        let actions = registry.definitions.map { PaletteItem(target: .action($0.id), title: $0.title, keywords: $0.keywords) }
        items = { actions + extraItems() }
    }

    /// Matching rows, best first: a title that starts with the query, then one with a word that does, then any other
    /// whose title or keywords contain the query's letters in order.
    public var results: [PaletteItem] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let all = items()
        guard !needle.isEmpty else { return all }
        return all.compactMap { item in Self.score(item, needle).map { (item, $0) } }
            .enumerated()
            .sorted { ($0.element.1, $0.offset) < ($1.element.1, $1.offset) }
            .map(\.element.0)
    }

    public var selected: PaletteItem? {
        let results = results
        return results.indices.contains(selectedIndex) ? results[selectedIndex] : nil
    }

    public func present() {
        query = ""
        selectedIndex = 0
        isPresented = true
    }

    public func moveSelection(by offset: Int) {
        let count = results.count
        guard count > 0 else { return }
        selectedIndex = (selectedIndex + offset + count) % count
    }

    public func select(_ item: PaletteItem) {
        if let index = results.firstIndex(of: item) { selectedIndex = index }
    }

    static func score(_ item: PaletteItem, _ needle: String) -> Int? {
        let title = item.title.lowercased()
        if title.hasPrefix(needle) { return 0 }
        if title.split(separator: " ").contains(where: { $0.hasPrefix(needle) }) { return 1 }
        if title.contains(needle) { return 2 }
        if item.keywords.contains(where: { $0.lowercased().hasPrefix(needle) }) { return 3 }
        if isSubsequence(needle, of: title) { return 4 }
        return nil
    }

    private static func isSubsequence(_ needle: String, of haystack: String) -> Bool {
        var remaining = needle[...]
        for character in haystack where character == remaining.first {
            remaining = remaining.dropFirst()
            if remaining.isEmpty { return true }
        }
        return remaining.isEmpty
    }
}
