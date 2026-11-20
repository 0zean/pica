import DesignSystem
import PicaProtocol
import SwiftUI

private enum Column {
    static let scope: CGFloat = 84
    static let health: CGFloat = 130
    static let tools: CGFloat = 56
    static let tokens: CGFloat = 110
    static let attached: CGFloat = 104
    static let actions: CGFloat = 120
}

struct ServerRowHeader: View {
    let showsAttachment: Bool

    var body: some View {
        HStack(spacing: Spacing.medium) {
            Text("Server").frame(maxWidth: .infinity, alignment: .leading)
            Text("Scope").frame(width: Column.scope, alignment: .leading)
            Text("Health").frame(width: Column.health, alignment: .leading)
            Text("Tools").frame(width: Column.tools, alignment: .trailing)
            Text("Token cost").frame(width: Column.tokens, alignment: .trailing)
                .help("Tool-definition tokens the server adds to every prompt of a session it is attached to.")
            if showsAttachment {
                Text("New sessions").frame(width: Column.attached, alignment: .center)
            }
            Color.clear.frame(width: Column.actions, height: 1)
        }
        .font(Typography.caption.weight(.semibold))
        .foregroundStyle(Palette.textSecondary)
        .padding(.horizontal, Spacing.medium)
        .padding(.vertical, Spacing.small)
        .accessibilityHidden(true)
    }
}

/// One server: name and where it runs, scope, health, tool count, token cost, the workspace's attachment, actions.
struct ServerRow: View {
    let server: McpServerDef
    let status: McpServerStatus?
    /// nil when no workspace is chosen.
    let attached: Binding<Bool>?
    let offersSignIn: Bool
    let edit: () -> Void
    let signIn: () -> Void
    let recheck: () -> Void
    let remove: () -> Void

    var body: some View {
        HStack(spacing: Spacing.medium) {
            VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                Text(server.name).font(Typography.headline).foregroundStyle(Palette.textPrimary)
                Text("\(server.id) · \(server.location)")
                    .font(Typography.caption).foregroundStyle(Palette.textSecondary).lineLimit(1).truncationMode(.middle)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(server.scopeTitle).font(Typography.callout).frame(width: Column.scope, alignment: .leading)
            HealthChip(status: status)
                .frame(width: Column.health, alignment: .leading)
                .accessibilityIdentifier("pica.mcp.health.\(server.id)")
            Text(status.map { String($0.tools.count) } ?? "—")
                .font(Typography.callout).monospacedDigit().frame(width: Column.tools, alignment: .trailing)
            Text(TokenText.format(status?.toolDefinitionTokens))
                .font(Typography.callout).monospacedDigit().frame(width: Column.tokens, alignment: .trailing)
                .accessibilityIdentifier("pica.mcp.tokens.\(server.id)")
            if let attached {
                Toggle("Attach to new sessions", isOn: attached)
                    .labelsHidden()
                    .frame(width: Column.attached)
                    .accessibilityIdentifier("pica.mcp.attachWorkspace.\(server.id)")
            }
            actions.frame(width: Column.actions, alignment: .trailing)
        }
        .padding(.horizontal, Spacing.medium)
        .padding(.vertical, Spacing.small)
        .contentShape(Rectangle())
        .onTapGesture(count: 2, perform: edit)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.mcp.row.\(server.id)")
    }

    private var actions: some View {
        HStack(spacing: Spacing.xSmall) {
            if offersSignIn && status?.state == .needsAuth {
                Button("Sign In", action: signIn).buttonStyle(.pica(.primary))
                    .accessibilityIdentifier("pica.mcp.signIn.\(server.id)")
            }
            Button("Edit", action: edit).buttonStyle(.pica())
                .disabled(server.scope == .repo)
                .accessibilityIdentifier("pica.mcp.edit.\(server.id)")
            Menu {
                Button("Check Now", action: recheck)
                if offersSignIn { Button("Sign In in Browser…", action: signIn) }
                Divider()
                Button("Remove…", role: .destructive, action: remove).disabled(server.scope == .repo)
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .accessibilityLabel("More")
            .accessibilityIdentifier("pica.mcp.more.\(server.id)")
        }
    }
}
