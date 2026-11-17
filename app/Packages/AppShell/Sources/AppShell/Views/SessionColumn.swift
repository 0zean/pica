import DesignSystem
import PicaProtocol
import SwiftUI

/// The middle column. A-05 puts the session timeline here; until then it names what is selected.
struct SessionColumn: View {
    let store: NavigationStore

    var body: some View {
        content
            .padding(Spacing.xLarge)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Palette.background)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("pica.session")
    }

    @ViewBuilder private var content: some View {
        switch store.selection {
        case .workspace(let id):
            if let workspace = store.workspace(id) {
                let repos = store.reposByWorkspace[id]?.count ?? 0
                let sessions = store.sidebar.first { $0.id == id }?.sessions.count ?? 0
                SelectedItem(title: workspace.name, detail: "Workspace · \(repos) repos · \(sessions) sessions")
            }
        case .repo(let workspaceId, let repoId):
            if let repo = store.repo(repoId, in: workspaceId) {
                SelectedItem(title: repo.displayName, detail: repo.localPath ?? repo.remoteUrl ?? repo.id)
            }
        case .session(let id):
            if let session = store.sessionsById[id] {
                SelectedItem(
                    title: session.displayTitle,
                    detail: "Session · \(SessionStatePresentation(session.state).label)")
            }
        case nil:
            EmptyState("No session selected", message: "Choose a workspace, repo or session in the sidebar.")
        }
    }
}

private struct SelectedItem: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: Spacing.small) {
            Text(title)
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("pica.session.title")
            Text(detail)
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .textSelection(.enabled)
        }
    }
}

/// The toggleable trailing column. Changes, Files, Terminal, Usage and Context arrive with their own units.
struct InspectorColumn: View {
    var body: some View {
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
        .background(Palette.background)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.inspector")
    }
}
