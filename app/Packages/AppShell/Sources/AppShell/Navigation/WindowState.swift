import Foundation

/// What the main window restores at launch (A-04), besides what AppKit keeps in the app's defaults: the window frame
/// and the sidebar's width (its split view autosaves under "NSSplitView Subview Frames main, …").
public struct WindowState: Codable, Equatable, Sendable {
    public var selection: SidebarItem?
    public var inspectorWidth: Double?
    public var isInspectorPresented = false
    public var collapsedWorkspaceIds: Set<String> = []

    public init() {}
}

/// `window-state.json` next to the socket, like `app.lock` (docs/app-shell.md). Tests give each launch its own directory.
public struct WindowStateFile: Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    /// The saved state, or a fresh one when there is none or it cannot be read.
    public func load() -> WindowState {
        guard let data = try? Data(contentsOf: url),
              let state = try? JSONDecoder().decode(WindowState.self, from: data)
        else { return WindowState() }
        return state
    }

    public func save(_ state: WindowState) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(state).write(to: url, options: .atomic)
    }
}
