import DesignSystem
import SwiftUI

/// The main window's three columns (PLAN.md §7.1): the sidebar, the session, and the toggleable inspector.
struct NavigationShell<Banner: View>: View {
    @Bindable var store: NavigationStore
    let sessionContent: SessionContent
    @ViewBuilder let banner: Banner

    static var sidebarWidths: (min: Double, ideal: Double, max: Double) { (180, 240, 420) }
    static var inspectorWidths: (min: Double, ideal: Double, max: Double) { (200, 280, 480) }

    var body: some View {
        NavigationSplitView {
            // AppKit saves and restores the sidebar's width in the app's defaults; `ideal` is the first launch's width.
            SidebarView(store: store)
                .navigationSplitViewColumnWidth(
                    min: Self.sidebarWidths.min, ideal: Self.sidebarWidths.ideal, max: Self.sidebarWidths.max)
        } detail: {
            SessionColumn(store: store, sessionContent: sessionContent)
                .safeAreaInset(edge: .top, spacing: 0) { banner }
                .inspector(isPresented: $store.isInspectorPresented) {
                    InspectorColumn()
                        .onGeometryChange(for: Double.self, of: { $0.size.width.rounded() }) { store.inspectorWidth = $0 }
                        .inspectorColumnWidth(
                            min: Self.inspectorWidths.min,
                            ideal: clamped(store.restoredInspectorWidth, Self.inspectorWidths),
                            max: Self.inspectorWidths.max)
                }
        }
        .navigationTitle(title)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    store.isInspectorPresented.toggle()
                } label: {
                    Label(store.isInspectorPresented ? "Hide Inspector" : "Show Inspector", systemImage: "sidebar.trailing")
                }
                .help(store.isInspectorPresented ? "Hide Inspector (⌥⌘I)" : "Show Inspector (⌥⌘I)")
                .accessibilityIdentifier("pica.toolbar.inspector")
            }
        }
    }

    private var title: String {
        switch store.selection {
        case .workspace(let id): store.workspace(id)?.name ?? "Pica"
        case .repo(let workspaceId, let repoId): store.repo(repoId, in: workspaceId)?.displayName ?? "Pica"
        case .session(let id): store.sessionsById[id]?.displayTitle ?? "Pica"
        case nil: "Pica"
        }
    }

    private func clamped(_ width: Double?, _ range: (min: Double, ideal: Double, max: Double)) -> Double {
        guard let width else { return range.ideal }
        return Swift.min(Swift.max(width, range.min), range.max)
    }
}

/// The menu items for moving around the window: ⌘1–9 for the sessions in sidebar order, ⌥⌘I for the inspector.
/// ⌘K, ⌘P and ⌘N belong to their own units (A-14, A-09, A-06).
public struct NavigationCommands: Commands {
    private let store: NavigationStore

    public init(store: NavigationStore) {
        self.store = store
    }

    public var body: some Commands {
        CommandGroup(after: .sidebar) {
            Button(store.isInspectorPresented ? "Hide Inspector" : "Show Inspector") {
                store.isInspectorPresented.toggle()
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
        }
        CommandMenu("Go") {
            let sessions = store.numberedSessions
            if sessions.isEmpty {
                Text("No sessions")
            }
            ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
                Button(session.displayTitle) {
                    store.select(.session(session.id))
                }
                .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
            }
        }
    }
}
