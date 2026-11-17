import DesignSystem
import EngineClient
import PicaProtocol
import SwiftUI

/// What an inspector pane is drawn for: the workspace of the sidebar's selection, the session when one is selected,
/// and the client to ask the engine with.
public struct InspectorContext {
    public let workspaceId: Id?
    public let session: Session?
    public let client: EngineClient
}

/// One tab of the inspector (PLAN.md §7.1: Changes, Files, Terminal, Usage, Context). Each feature's unit supplies its
/// pane; the app target hands them to `RootView`, so AppShell depends on none of them.
public struct InspectorPane: Identifiable {
    /// Stable: `pica.inspector.tab.<id>` names its tab, and the chosen tab is remembered by it.
    public let id: String
    public let title: String
    public let systemImage: String
    public let content: @MainActor (InspectorContext) -> AnyView

    public init(id: String, title: String, systemImage: String, content: @escaping @MainActor (InspectorContext) -> AnyView) {
        self.id = id
        self.title = title
        self.systemImage = systemImage
        self.content = content
    }
}

/// The toggleable trailing column: the panes as tabs, the chosen one under them.
struct InspectorColumn: View {
    let store: NavigationStore
    let panes: [InspectorPane]
    @AppStorage("pica.inspector.pane") private var chosen = ""

    var body: some View {
        VStack(spacing: 0) {
            if panes.isEmpty {
                placeholder
            } else {
                if panes.count > 1 {
                    Picker("Inspector", selection: selection) {
                        ForEach(panes) { pane in
                            Label(pane.title, systemImage: pane.systemImage)
                                .tag(pane.id)
                                .accessibilityIdentifier("pica.inspector.tab.\(pane.id)")
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .padding(Spacing.small)
                    Divider()
                }
                if let pane = panes.first(where: { $0.id == selection.wrappedValue }) {
                    pane.content(context)
                        .id("\(pane.id).\(context.workspaceId ?? "")")
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.inspector")
    }

    private var selection: Binding<String> {
        Binding(
            get: { panes.contains { $0.id == chosen } ? chosen : panes.first?.id ?? "" },
            set: { chosen = $0 })
    }

    private var context: InspectorContext {
        let workspaceId = store.selection.flatMap(store.workspaceId(of:))
        let session: Session? = if case .session(let id) = store.selection { store.sessionsById[id] } else { nil }
        return InspectorContext(workspaceId: workspaceId, session: session, client: store.client)
    }

    private var placeholder: some View {
        VStack(spacing: Spacing.small) {
            Text("Inspector")
                .font(Typography.headline)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text("Changes, files, terminal, usage and context appear here.")
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(Spacing.large)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
