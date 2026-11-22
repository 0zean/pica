import DesignSystem
import PicaProtocol
import SwiftUI

/// New Session (⌘N, docs/workspaces.md): each of the workspace's repos as Write, Reference or not in the session, a
/// first prompt, and Start. A repo that is listed but not cloned has a Clone button instead of a role.
struct NewSessionSheet: View {
    let store: NewSessionStore
    let manager: WorkspaceManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let repos = store.current(manager.repos(store.workspaceId))
        let blocker = store.startBlocker(repos: repos)
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text("New Session")
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text("The session can change the repos it writes to and only reads the ones it references.")
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            repoList(repos)
            if let problem = store.cloneProblem {
                ProblemBanner(
                    problem: problem, fixes: manager.fixes, identifier: "pica.newSession.cloneProblem",
                    openSettings: manager.openSettings)
            }
            VStack(alignment: .leading, spacing: Spacing.xSmall) {
                Text("First prompt")
                    .font(Typography.headline)
                    .foregroundStyle(Palette.textPrimary)
                @Bindable var store = store
                TextEditor(text: $store.prompt)
                    .font(Typography.body)
                    .frame(minHeight: 90, maxHeight: 180)
                    .scrollContentBackground(.hidden)
                    .padding(Spacing.xSmall)
                    .background(RoundedRectangle(cornerRadius: Radius.small).fill(Palette.surface))
                    .accessibilityIdentifier("pica.newSession.prompt")
                Text("Optional. Leave it empty to write the first message in the composer.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
            if let problem = store.problem {
                ProblemBanner(
                    problem: problem, fixes: manager.fixes, identifier: "pica.newSession.problem",
                    retry: start, openSettings: manager.openSettings)
            }
            HStack(spacing: Spacing.small) {
                if store.isStarting {
                    ProgressView().controlSize(.small)
                }
                if let blocker, !store.isStarting {
                    Text(blocker)
                        .font(Typography.callout)
                        .foregroundStyle(Palette.textSecondary)
                        .accessibilityIdentifier("pica.newSession.reason")
                }
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.pica(.secondary))
                    .keyboardShortcut(.cancelAction)
                Button("Start", action: start)
                    .buttonStyle(.pica(.primary))
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(blocker != nil)
                    .help("Start the session (⌘↩)")
                    .accessibilityIdentifier("pica.newSession.start")
            }
        }
        .padding(Spacing.xLarge)
        .frame(width: 600)
        .onAppear { store.applyDefaults(repos: repos) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.newSession")
    }

    @ViewBuilder private func repoList(_ repos: [Repo]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            Text("Repositories")
                .font(Typography.headline)
                .foregroundStyle(Palette.textPrimary)
            if repos.isEmpty {
                Text("This workspace has no repositories. Add one or import a team first.")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xSmall) {
                    ForEach(repos, id: \.id) { repo in
                        NewSessionRepoRow(repo: repo, store: store)
                    }
                }
            }
            .frame(maxHeight: 240)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func start() {
        Task {
            if await manager.startSession() { dismiss() }
        }
    }
}

private struct NewSessionRepoRow: View {
    let repo: Repo
    let store: NewSessionStore

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
            }
            Spacer()
            if NewSessionStore.isUsable(repo) {
                Picker("Role", selection: Binding(get: { store.role(of: repo.id) }, set: { store.setRole($0, for: repo.id) })) {
                    Text("Not used").tag(NewSessionStore.Role.unused)
                    Text("Write").tag(NewSessionStore.Role.write)
                    Text("Reference").tag(NewSessionStore.Role.reference)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                .accessibilityLabel("\(repo.name) role")
                .accessibilityIdentifier("pica.newSession.repo.\(repo.name).role")
            } else if store.cloning.contains(repo.id) {
                ProgressView().controlSize(.small)
                Text("Cloning…")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            } else if repo.remoteUrl != nil {
                Text("Not cloned")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
                Button("Clone") { Task { await store.clone(repo) } }
                    .buttonStyle(.pica(.secondary))
                    .help("Clone into Pica's repos folder so the session can use it. A large repository can take a few minutes.")
                    .accessibilityIdentifier("pica.newSession.repo.\(repo.name).clone")
            } else {
                Text("Not cloned")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            }
        }
        .padding(.vertical, Spacing.xxSmall)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.newSession.repo.\(repo.name)")
    }
}
