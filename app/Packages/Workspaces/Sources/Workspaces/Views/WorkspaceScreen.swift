import DesignSystem
import PicaProtocol
import SwiftUI

/// A workspace in the session column when it is selected in the sidebar (docs/workspaces.md): its sources with their
/// sync status, its repos with their clone state, and the buttons that start a session, add repos and import teams. The app target
/// passes the workspace and repos the sidebar's store holds, which follow `workspace.changed`.
public struct WorkspaceScreen: View {
    let workspace: Workspace
    let repos: [Repo]
    let manager: WorkspaceManager

    public init(workspace: Workspace, repos: [Repo], manager: WorkspaceManager) {
        self.workspace = workspace
        self.repos = repos
        self.manager = manager
    }

    public var body: some View {
        let store = manager.store(for: workspace.id)
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xLarge) {
                header
                actions(store)
                syncStatus(store)
                sources(store)
                repositories
            }
            .padding(Spacing.xLarge)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.workspace")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            Text(workspace.name)
                .font(Typography.largeTitle)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("pica.session.title")
            Text("Workspace · \(count(repos.count, "repo")) · \(count(workspace.sources.count, "source"))")
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
        }
    }

    private func actions(_ store: WorkspaceStore) -> some View {
        HStack(spacing: Spacing.small) {
            let unavailable = NewSessionStore.unavailableReason(workspaceId: workspace.id, repos: repos)
            Button {
                manager.presentNewSession(workspaceId: workspace.id)
            } label: {
                Label("New Session…", systemImage: "bubble.left.and.text.bubble.right")
            }
            .buttonStyle(.pica(.primary))
            .disabled(unavailable != nil)
            .help(unavailable ?? "Start a session in this workspace (⌘N)")
            .accessibilityIdentifier("pica.workspace.newSession")
            Button {
                manager.presentAddRepository(workspaceId: workspace.id)
            } label: {
                Label("Add Repository…", systemImage: "plus")
            }
            .buttonStyle(.pica(.secondary))
            .accessibilityIdentifier("pica.workspace.addRepository")
            Button {
                manager.presentTeamBrowser(workspaceId: workspace.id)
            } label: {
                Label("Import Teams…", systemImage: "person.3")
            }
            .buttonStyle(.pica(.secondary))
            .accessibilityIdentifier("pica.workspace.importTeams")
            Spacer()
            Button {
                manager.sync(workspaceId: workspace.id)
            } label: {
                Label("Sync", systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(.pica(.secondary))
            .disabled(workspace.sources.isEmpty || store.isSyncing)
            .accessibilityIdentifier("pica.workspace.sync")
        }
    }

    @ViewBuilder private func syncStatus(_ store: WorkspaceStore) -> some View {
        HStack(spacing: Spacing.small) {
            if store.isSyncing {
                ProgressView().controlSize(.small)
            }
            Text(SyncStatus.summary(store.sync, sources: workspace.sources.count))
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .accessibilityIdentifier("pica.workspace.syncStatus")
        }
        if case .failed(let problem) = store.sync {
            ProblemBanner(
                problem: problem, fixes: manager.fixes, identifier: "pica.workspace.problem",
                retry: { manager.sync(workspaceId: workspace.id) }, openSettings: manager.openSettings)
        }
    }

    private func sources(_ store: WorkspaceStore) -> some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            SectionTitle("Sources")
            if workspace.sources.isEmpty {
                Text("No sources. Import a GitHub team to add its repos as available.")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            }
            TimelineView(.periodic(from: .now, by: 30)) { context in
                VStack(alignment: .leading, spacing: Spacing.small) {
                    ForEach(workspace.sources, id: \.id) { source in
                        SourceRow(source: source, now: context.date) {
                            Task { await store.removeSource(source) }
                        }
                    }
                }
            }
            if let problem = store.sourceProblem {
                ProblemBanner(problem: problem, fixes: manager.fixes, identifier: "pica.workspace.sourceProblem")
            }
        }
    }

    private var repositories: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            SectionTitle("Repositories")
            if repos.isEmpty {
                Text("No repositories yet. Add one by path or URL, or import a team.")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            }
            VStack(alignment: .leading, spacing: Spacing.small) {
                ForEach(repos, id: \.id) { repo in
                    RepoManagementRow(repo: repo, pinned: workspace.pinnedRepoIds.contains(repo.id))
                }
            }
        }
    }

    private func count(_ value: Int, _ noun: String) -> String {
        value == 1 ? "1 \(noun)" : "\(value) \(noun)s"
    }
}

private struct SectionTitle: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(Typography.headline)
            .foregroundStyle(Palette.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct SourceRow: View {
    let source: RepoSource
    let now: Date
    let remove: () -> Void

    var body: some View {
        HStack(spacing: Spacing.small) {
            Image(systemName: source.kind == .team ? "person.3" : "tag")
                .foregroundStyle(Palette.textSecondary)
                .frame(width: 20)
                .accessibilityHidden(true)
            Text(source.title)
                .font(Typography.body)
                .foregroundStyle(Palette.textPrimary)
            Spacer()
            Text(SyncStatus.sourceLabel(lastSyncedAt: source.lastSyncedAt, now: now))
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .accessibilityIdentifier("pica.workspace.source.\(source.key).status")
            Button(action: remove) {
                Image(systemName: "minus.circle")
            }
            .buttonStyle(.borderless)
            .help("Remove this source. Pinned and cloned repos stay.")
            .accessibilityLabel("Remove \(source.title)")
            .accessibilityIdentifier("pica.workspace.source.\(source.key).remove")
        }
        .padding(.vertical, Spacing.xSmall)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.workspace.source.\(source.key)")
    }
}

private struct RepoManagementRow: View {
    let repo: Repo
    let pinned: Bool

    var body: some View {
        HStack(spacing: Spacing.small) {
            Image(systemName: repo.localPath == nil ? "cloud" : "folder")
                .foregroundStyle(Palette.textSecondary)
                .frame(width: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                Text(repo.name)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textPrimary)
                Text(repo.localPath ?? repo.remoteUrl ?? repo.id)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            Spacer()
            if pinned {
                Image(systemName: "pin")
                    .foregroundStyle(Palette.textSecondary)
                    .help("Pinned: stays in the workspace whatever its sources list.")
                    .accessibilityLabel("Pinned")
            }
            Chip(SyncStatus.cloneLabel(repo.cloneState), tone: tone)
                .accessibilityIdentifier("pica.workspace.repo.\(repo.name).state")
        }
        .padding(.vertical, Spacing.xSmall)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.workspace.repo.\(repo.name)")
    }

    private var tone: Chip.Tone {
        switch repo.cloneState {
        case .available: .neutral
        case .cloning: .accent
        case .cloned: .success
        case .failed: .danger
        }
    }
}
