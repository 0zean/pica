import DesignSystem
import PicaProtocol
import SwiftUI

/// Workspaces, their repos and their sessions. Arrow keys move the selection, which is what opens an item;
/// Left and Right collapse and expand a workspace.
struct SidebarView: View {
    @Bindable var store: NavigationStore
    /// In the sidebar's toolbar, from the app target: workspace management's add menu (A-12).
    var accessory: AnyView?
    @FocusState private var listFocused: Bool

    var body: some View {
        List(selection: $store.selection) {
            ForEach(store.sidebar) { entry in
                DisclosureGroup(isExpanded: expansion(entry.id)) {
                    ForEach(entry.repos, id: \.id) { repo in
                        RepoRow(repo: repo)
                            .tag(SidebarItem.repo(workspaceId: entry.id, repoId: repo.id))
                    }
                    ForEach(entry.sessions, id: \.id) { session in
                        SessionRow(session: session)
                            .tag(SidebarItem.session(session.id))
                    }
                } label: {
                    WorkspaceRow(workspace: entry.workspace)
                        .tag(SidebarItem.workspace(entry.id))
                }
            }
        }
        .listStyle(.sidebar)
        .focused($listFocused)
        .accessibilityIdentifier("pica.sidebar")
        .overlay {
            if store.hasLoaded && store.workspaces.isEmpty {
                Text("No workspaces yet")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let failure = store.loadFailure {
                Text(failure)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.danger)
                    .lineLimit(3)
                    .padding(Spacing.small)
                    .accessibilityIdentifier("pica.sidebar.failure")
            }
        }
        .toolbar {
            if let accessory {
                ToolbarItem(placement: .primaryAction) { accessory }
            }
        }
        .onAppear { listFocused = true }
    }

    private func expansion(_ workspaceId: Id) -> Binding<Bool> {
        Binding(
            get: { store.isExpanded(workspaceId) },
            set: { store.setExpanded($0, workspaceId: workspaceId) })
    }
}

struct WorkspaceRow: View {
    let workspace: Workspace

    var body: some View {
        Label {
            Text(workspace.name)
                .font(Typography.headline)
                .foregroundStyle(Palette.textPrimary)
        } icon: {
            Image(systemName: "square.stack.3d.up")
        }
        .accessibilityIdentifier("pica.sidebar.workspace.\(workspace.id)")
    }
}

struct RepoRow: View {
    let repo: Repo

    var body: some View {
        Label {
            Text(repo.displayName)
                .font(Typography.body)
                .foregroundStyle(Palette.textPrimary)
        } icon: {
            Image(systemName: "folder")
        }
        .help(repo.localPath ?? repo.remoteUrl ?? repo.id)
        .accessibilityIdentifier("pica.sidebar.repo.\(repo.id)")
    }
}

struct SessionRow: View {
    let session: Session

    var body: some View {
        let status = SessionStatePresentation(session.state)
        HStack(spacing: Spacing.small) {
            ActivityMark(isWorking: status.isWorking)
                .frame(width: 16, height: 16)
                .accessibilityHidden(true)
            Text(session.displayTitle)
                .font(Typography.body)
                .foregroundStyle(Palette.textPrimary)
                .lineLimit(1)
            Spacer(minLength: Spacing.xSmall)
            if session.state.needsAttention || session.state == .running {
                Chip(status.label, tone: status.tone)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(session.displayTitle), \(status.label)")
        .accessibilityIdentifier("pica.sidebar.session.\(session.id)")
    }
}
