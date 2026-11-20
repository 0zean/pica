import DesignSystem
import PicaProtocol
import SwiftUI

/// The team browser (docs/workspaces.md): search the signed-in user's GitHub teams, tick several, see the focused
/// team's repos, and import the ticked ones into the workspace. Space ticks the focused team; ⌘A ticks every team the
/// search shows.
struct TeamBrowserSheet: View {
    let workspace: WorkspaceStore
    let manager: WorkspaceManager
    @State private var store: TeamBrowserStore
    @Environment(\.dismiss) private var dismiss
    @FocusState private var listFocused: Bool

    init(workspace: WorkspaceStore, manager: WorkspaceManager) {
        self.workspace = workspace
        self.manager = manager
        _store = State(initialValue: TeamBrowserStore(backend: manager.backend))
    }

    var body: some View {
        @Bindable var store = store
        VStack(alignment: .leading, spacing: Spacing.medium) {
            header
            TextField("Search teams", text: $store.query)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("pica.teams.search")
            content
            if case .failed(let problem) = store.importState {
                ProblemBanner(
                    problem: problem, fixes: manager.fixes, identifier: "pica.teams.importProblem",
                    retry: { runImport() }, openSettings: manager.openSettings)
            }
            footer
        }
        .padding(Spacing.xLarge)
        .frame(width: 640, height: 520)
        .task { await store.load() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.teams")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.xxSmall) {
            Text("Import Teams")
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(accountLine)
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .accessibilityIdentifier("pica.teams.account")
        }
    }

    private var accountLine: String {
        guard let account = store.account else { return "Each team's repos are added as available, and cloned when first used." }
        guard account.signedIn, let login = account.login else { return "Not signed in to \(account.host)." }
        return "Signed in to \(account.host) as \(login). Each team's repos are added as available, and cloned when first used."
    }

    @ViewBuilder private var content: some View {
        switch store.phase {
        case .loading:
            ProgressView("Listing your teams…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let problem):
            ProblemBanner(
                problem: problem, fixes: manager.fixes, identifier: "pica.teams.problem",
                retry: { Task { await store.load() } }, openSettings: manager.openSettings)
            Spacer()
        case .loaded:
            HStack(alignment: .top, spacing: Spacing.medium) {
                teamList
                    .frame(width: 300)
                TeamPreview(store: store, fixes: manager.fixes)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }

    private var teamList: some View {
        @Bindable var store = store
        return List(selection: $store.focused) {
            ForEach(store.visibleTeams) { team in
                Toggle(isOn: Binding(get: { store.isSelected(team) }, set: { store.setSelected($0, team) })) {
                    VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                        Text(team.name)
                            .font(Typography.body)
                            .foregroundStyle(Palette.textPrimary)
                        Text(team.id)
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecondary)
                    }
                }
                .toggleStyle(.checkbox)
                .tag(team.id)
                .accessibilityIdentifier("pica.teams.row.\(team.id)")
            }
        }
        .focused($listFocused)
        .onKeyPress(.space) {
            guard let id = store.focused, let team = store.teams.first(where: { $0.id == id }) else { return .ignored }
            store.toggle(team)
            return .handled
        }
        .onKeyPress(characters: ["a"], phases: .down) { press in
            guard press.modifiers == .command else { return .ignored }
            store.toggleAllVisible()
            return .handled
        }
        .overlay {
            if store.visibleTeams.isEmpty {
                Text(store.teams.isEmpty ? "You are on no teams." : "No team matches “\(store.query)”.")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            }
        }
        .task(id: store.focused) { await store.loadPreview() }
        .accessibilityIdentifier("pica.teams.list")
    }

    private var footer: some View {
        HStack(spacing: Spacing.small) {
            Text(store.selected.isEmpty ? "No teams chosen" : "\(store.selected.count) chosen")
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .accessibilityIdentifier("pica.teams.chosen")
            Spacer()
            if store.isImporting {
                ProgressView().controlSize(.small)
            }
            Button("Cancel") { dismiss() }
                .buttonStyle(.pica(.secondary))
                .keyboardShortcut(.cancelAction)
            Button(importTitle) { runImport() }
                .buttonStyle(.pica(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(store.selected.isEmpty || store.isImporting)
                .accessibilityIdentifier("pica.teams.import")
        }
    }

    private var importTitle: String {
        store.selected.count > 1 ? "Import \(store.selected.count) Teams" : "Import Team"
    }

    private func runImport() {
        Task {
            if await store.importSelected(into: workspace) { dismiss() }
        }
    }
}

/// The focused team's repos, as the sync would add them.
private struct TeamPreview: View {
    let store: TeamBrowserStore
    let fixes: FixPerformer

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            switch store.preview {
            case .none:
                Text("Select a team to see its repos.")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            case .loading:
                ProgressView().controlSize(.small)
            case .loaded(let id, let repos):
                Text("\(id) · \(repos.count == 1 ? "1 repo" : "\(repos.count) repos")")
                    .font(Typography.headline)
                    .foregroundStyle(Palette.textPrimary)
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.xSmall) {
                        ForEach(repos, id: \.fullName) { repo in
                            Text(repo.fullName)
                                .font(Typography.body)
                                .foregroundStyle(Palette.textPrimary)
                                .accessibilityIdentifier("pica.teams.preview.\(repo.fullName)")
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            case .failed(let id, let problem):
                Text(id)
                    .font(Typography.headline)
                    .foregroundStyle(Palette.textPrimary)
                ProblemBanner(
                    problem: problem, fixes: fixes, identifier: "pica.teams.previewProblem",
                    retry: { Task { await store.loadPreview() } })
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.teams.preview")
    }
}
