import DesignSystem
import PicaProtocol
import EngineClient
import SwiftUI

/// Draws a selected session in the session column, given the client to follow it with.
public typealias SessionContent = @MainActor (Session, EngineClient) -> AnyView

/// The middle column: the selected session, as the app target draws it (the timeline, A-05), or what is selected
/// when it is not a session.
public struct SessionColumn: View {
    let store: NavigationStore
    let sessionContent: SessionContent

    /// Names the session, for previews and tests that run without the timeline.
    public static let placeholder: SessionContent = { session, _ in
        AnyView(
            SelectedItem(title: session.displayTitle, detail: "Session · \(SessionStatePresentation(session.state).label)")
                .padding(Spacing.xLarge))
    }

    public var body: some View {
        content
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
                    .padding(Spacing.xLarge)
            }
        case .repo(let workspaceId, let repoId):
            if let repo = store.repo(repoId, in: workspaceId) {
                SelectedItem(title: repo.displayName, detail: repo.localPath ?? repo.remoteUrl ?? repo.id)
                    .padding(Spacing.xLarge)
            }
        case .session(let id):
            if let session = store.sessionsById[id] {
                sessionContent(session, store.client)
                    .id(id)
            }
        case nil:
            EmptyState("No session selected", message: "Choose a workspace, repo or session in the sidebar.")
                .padding(Spacing.xLarge)
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
