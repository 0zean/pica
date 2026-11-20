import AppKit
import DesignSystem
import SwiftUI

/// Add Repository (docs/workspaces.md): a folder on this Mac, registered where it is, or a URL, cloned into Pica's
/// managed directory. Either way the repo is pinned to the workspace.
struct AddRepositorySheet: View {
    let workspace: WorkspaceStore
    let manager: WorkspaceManager
    @State private var location = ""
    @Environment(\.dismiss) private var dismiss
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text("Add Repository")
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text("A folder on this Mac is used where it is. A URL is cloned into Pica's repos folder.")
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Spacing.small) {
                TextField("/path/to/repo or https://host/org/repo.git", text: $location)
                    .textFieldStyle(.roundedBorder)
                    .focused($fieldFocused)
                    .onSubmit(add)
                    .accessibilityIdentifier("pica.addRepository.location")
                Button("Choose Folder…", action: chooseFolder)
                    .buttonStyle(.pica(.secondary))
                    .accessibilityIdentifier("pica.addRepository.choose")
            }
            if case .adding(let target) = workspace.adding {
                HStack(spacing: Spacing.small) {
                    ProgressView().controlSize(.small)
                    Text(progressText(target))
                        .font(Typography.callout)
                        .foregroundStyle(Palette.textSecondary)
                }
            }
            if case .failed(let problem) = workspace.adding {
                ProblemBanner(
                    problem: problem, fixes: manager.fixes, identifier: "pica.addRepository.problem",
                    retry: add, openSettings: manager.openSettings)
            }
            HStack(spacing: Spacing.small) {
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.pica(.secondary))
                    .keyboardShortcut(.cancelAction)
                Button("Add", action: add)
                    .buttonStyle(.pica(.primary))
                    .keyboardShortcut(.defaultAction)
                    .disabled(location.trimmingCharacters(in: .whitespaces).isEmpty || workspace.isAdding)
                    .accessibilityIdentifier("pica.addRepository.add")
            }
        }
        .padding(Spacing.xLarge)
        .frame(width: 560)
        .onAppear { fieldFocused = true }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.addRepository")
    }

    private func progressText(_ target: RepoLocation) -> String {
        switch target {
        case .path: "Adding…"
        case .url: "Cloning… a large repository can take a few minutes."
        }
    }

    private func add() {
        let input = location
        Task {
            if await workspace.addRepo(input) { dismiss() }
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        if panel.runModal() == .OK, let url = panel.url {
            location = url.path
        }
    }
}

/// New Workspace: a name, and the workspace is selected once the engine has created it.
struct NewWorkspaceSheet: View {
    let manager: WorkspaceManager
    @State private var name = ""
    @Environment(\.dismiss) private var dismiss
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text("New Workspace")
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            TextField("Name, such as Payments", text: $name)
                .textFieldStyle(.roundedBorder)
                .focused($fieldFocused)
                .onSubmit(create)
                .accessibilityIdentifier("pica.newWorkspace.name")
            if let problem = manager.createProblem {
                ProblemBanner(problem: problem, fixes: manager.fixes, identifier: "pica.newWorkspace.problem", retry: create)
            }
            HStack(spacing: Spacing.small) {
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.pica(.secondary))
                    .keyboardShortcut(.cancelAction)
                Button("Create", action: create)
                    .buttonStyle(.pica(.primary))
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || manager.isCreating)
                    .accessibilityIdentifier("pica.newWorkspace.create")
            }
        }
        .padding(Spacing.xLarge)
        .frame(width: 420)
        .onAppear { fieldFocused = true }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.newWorkspace")
    }

    private func create() {
        let name = name
        Task {
            if await manager.createWorkspace(named: name) { dismiss() }
        }
    }
}
