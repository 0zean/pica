import DesignSystem
import PicaProtocol
import SwiftUI

/// New Session (⌘N, docs/workspaces.md): each of the workspace's repos as Write, Reference or not in the session, its
/// mode and models, a first prompt, and Start. A repo that is listed but not cloned has a Clone button instead of a role.
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
            NewSessionRoutingPickers(store: store)
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
        .task { await store.loadRouting() }
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

/// The session's mode (routing profile) and the models its reasoning and worker tiers run on. They start as the
/// workspace's default mode and the tier settings in Settings; a choice managed policy locks is shown, not offered.
private struct NewSessionRoutingPickers: View {
    let store: NewSessionStore

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            Text("Mode and models")
                .font(Typography.headline)
                .foregroundStyle(Palette.textPrimary)
            Grid(alignment: .leading, horizontalSpacing: Spacing.medium, verticalSpacing: Spacing.xSmall) {
                GridRow {
                    Text("Mode")
                        .font(Typography.callout)
                        .foregroundStyle(Palette.textSecondary)
                    Picker("Mode", selection: Binding(
                        get: { store.profile ?? store.routing?.defaultProfile ?? .off },
                        set: { store.setProfile($0) })) {
                        ForEach(RoutingProfile.allCases, id: \.self) { profile in
                            Text(Self.title(profile)).tag(profile)
                        }
                    }
                    .labelsHidden()
                    .fixedSize()
                    .disabled(store.routing == nil || store.routing?.profileLock != nil)
                    .accessibilityLabel("Mode")
                    .accessibilityIdentifier("pica.newSession.mode")
                    lockNote(store.routing?.profileLock)
                }
                ForEach(Tier.allCases, id: \.self) { tier in
                    GridRow {
                        Text(tier == .reasoning ? "Reasoning model" : "Worker model")
                            .font(Typography.callout)
                            .foregroundStyle(Palette.textSecondary)
                        tierPicker(tier)
                        lockNote(store.routing?.tierLocks[tier])
                    }
                }
            }
            Text("Off runs everything on the reasoning model. Balanced and Strict hand reads and edits to sub-agents on the worker model; Strict keeps the main agent from editing files.")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private func tierPicker(_ tier: Tier) -> some View {
        let routing = store.routing
        let current = store.tierSetting(tier)
        let models = (routing?.models ?? []).filter { $0.allowedByPolicy || $0.id == current }
        Picker(tier == .reasoning ? "Reasoning model" : "Worker model", selection: Binding(
            get: { current }, set: { store.setTier(tier, to: $0) })) {
            Text(autoTitle(tier)).tag("auto")
            ForEach(models, id: \.id) { model in
                Text(model.name).tag(model.id)
            }
            if current != "auto", !models.contains(where: { $0.id == current }) {
                Text(current).tag(current)
            }
        }
        .labelsHidden()
        .fixedSize()
        .disabled(routing == nil || routing?.tierLocks[tier] != nil)
        .accessibilityLabel(tier == .reasoning ? "Reasoning model" : "Worker model")
        .accessibilityIdentifier("pica.newSession.tier.\(tier.rawValue)")
    }

    private func autoTitle(_ tier: Tier) -> String {
        guard let routing = store.routing, routing.setting(tier) == "auto", let name = routing.resolvedName(tier) else {
            return "Auto"
        }
        return "Auto (\(name))"
    }

    @ViewBuilder private func lockNote(_ policy: String?) -> some View {
        if let policy {
            Label("Locked by “\(policy)”", systemImage: "lock.fill")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecondary)
        } else {
            Color.clear.frame(width: 0, height: 0)
        }
    }

    static func title(_ profile: RoutingProfile) -> String {
        switch profile {
        case .off: "Off"
        case .balanced: "Balanced"
        case .strict: "Strict"
        }
    }
}
