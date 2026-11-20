import DesignSystem
import PicaProtocol
import SwiftUI

/// The inspector's MCP pane: the session's servers out of its workspace's, with what they add to each prompt. A change
/// to a live session asks first, since it costs the session its prompt cache (PLAN.md §5.5).
public struct SessionMcpPane: View {
    @State private var store: SessionMcpStore
    private let session: Session
    @Environment(\.openWindow) private var openWindow

    public init(session: Session, backend: any McpBackend) {
        self.session = session
        _store = State(initialValue: SessionMcpStore(backend: backend))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            HStack {
                Text("MCP servers").font(Typography.headline)
                Spacer()
                Text(TokenText.format(store.toolDefinitionTokens))
                    .font(Typography.caption).foregroundStyle(Palette.textSecondary)
                    .help("Tool-definition tokens this session's servers add to every prompt.")
                    .accessibilityIdentifier("pica.mcp.session.tokens")
            }
            if let message = store.message {
                Text(message).font(Typography.caption).foregroundStyle(Palette.danger)
            }
            if store.servers.isEmpty {
                Text("No MCP servers are defined for this workspace.")
                    .font(Typography.callout).foregroundStyle(Palette.textSecondary)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xSmall) {
                    ForEach(store.servers, id: \.id) { server in
                        row(server)
                    }
                }
            }
            Button("Manage Servers…") { openWindow(id: McpServersScreen.windowId) }
                .buttonStyle(.pica())
                .accessibilityIdentifier("pica.mcp.session.manage")
        }
        .padding(Spacing.medium)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: session.id) { await store.load(session: session) }
        .task { await store.watchStatuses() }
        .alert(
            "Reset this session's prompt cache?", isPresented: pendingBinding, presenting: store.pendingChange
        ) { _ in
            Button("Change Servers") { Task { await store.confirmPendingChange() } }
                .accessibilityIdentifier("pica.mcp.cacheWarning.confirm")
            Button("Cancel", role: .cancel) { store.cancelPendingChange() }
        } message: { change in
            Text(Self.warning(for: change))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.mcp.session")
    }

    private func row(_ server: McpServerDef) -> some View {
        HStack(spacing: Spacing.small) {
            Toggle(isOn: Binding(get: { store.attached.contains(server.id) }, set: { _ in Task { await store.toggle(server) } })) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(server.name).font(Typography.body)
                    Text(TokenText.format(store.statuses[server.id]?.toolDefinitionTokens))
                        .font(Typography.caption).foregroundStyle(Palette.textSecondary)
                }
            }
            .toggleStyle(.checkbox)
            .accessibilityIdentifier("pica.mcp.session.toggle.\(server.id)")
            Spacer()
            HealthChip(status: store.statuses[server.id])
        }
    }

    private var pendingBinding: Binding<Bool> {
        Binding(get: { store.pendingChange != nil }, set: { if !$0 { store.cancelPendingChange() } })
    }

    /// What the warning says: the change, its token cost, and that the next turn pays for the whole context again.
    static func warning(for change: SessionMcpStore.PendingChange) -> String {
        let verb = change.attach ? "Adding" : "Removing"
        let cost = change.toolDefinitionTokens.map { " (\($0.formatted()) tool-definition tokens per prompt)" } ?? ""
        return "\(verb) \(change.serverName)\(cost) restarts this session's runtime with a new tool set. Its prompt cache "
            + "is lost: the next turn pays full input price for the whole conversation. The conversation itself is kept."
    }
}
