import DesignSystem
import PicaProtocol
import SwiftUI

/// Rename Workspace: the current name to edit, checked as it is typed (docs/workspaces.md, "Renaming").
struct RenameWorkspaceSheet: View {
    let manager: WorkspaceManager
    let workspaceId: Id
    @State private var name: String
    @Environment(\.dismiss) private var dismiss
    @FocusState private var fieldFocused: Bool

    init(manager: WorkspaceManager, workspaceId: Id) {
        self.manager = manager
        self.workspaceId = workspaceId
        _name = State(initialValue: manager.workspace(workspaceId)?.name ?? "")
    }

    var body: some View {
        let problem = manager.nameProblem(name, renaming: workspaceId)
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text("Rename Workspace")
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)
                .focused($fieldFocused)
                .onSubmit(rename)
                .accessibilityIdentifier("pica.renameWorkspace.name")
            if let problem {
                Text(problem)
                    .font(Typography.callout)
                    .foregroundStyle(Palette.danger)
                    .accessibilityIdentifier("pica.renameWorkspace.invalid")
            }
            if let failure = manager.renameProblem {
                ProblemBanner(problem: failure, fixes: manager.fixes, identifier: "pica.renameWorkspace.problem", retry: rename)
            }
            HStack(spacing: Spacing.small) {
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.pica(.secondary))
                    .keyboardShortcut(.cancelAction)
                Button("Rename", action: rename)
                    .buttonStyle(.pica(.primary))
                    .keyboardShortcut(.defaultAction)
                    .disabled(problem != nil || manager.isRenaming)
                    .accessibilityIdentifier("pica.renameWorkspace.save")
            }
        }
        .padding(Spacing.xLarge)
        .frame(width: 420)
        .onAppear { fieldFocused = true }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.renameWorkspace")
    }

    private func rename() {
        let name = name
        Task {
            if await manager.renameWorkspace(workspaceId, to: name) { dismiss() }
        }
    }
}

/// Rename and Delete for one workspace, for a context menu or the workspace screen's menu.
public struct WorkspaceActionsMenuItems: View {
    let manager: WorkspaceManager
    let workspaceId: Id

    public init(manager: WorkspaceManager, workspaceId: Id) {
        self.manager = manager
        self.workspaceId = workspaceId
    }

    public var body: some View {
        Button("Rename…") { manager.presentRename(workspaceId: workspaceId) }
            .accessibilityIdentifier("pica.workspaceMenu.rename")
        Divider()
        Button("Delete Workspace…", role: .destructive) { manager.requestDelete(workspaceId: workspaceId) }
            .accessibilityIdentifier("pica.workspaceMenu.delete")
    }
}

/// The confirmation before a workspace is deleted, and the engine's answer when it refuses.
struct WorkspaceDeletionAlerts: ViewModifier {
    @Bindable var manager: WorkspaceManager

    func body(content: Content) -> some View {
        let deletion = manager.pendingDeletion
        content
            .alert(
                deletion?.title ?? "", isPresented: present(\.pendingDeletion), presenting: deletion
            ) { deletion in
                if deletion.isBlocked {
                    Button("OK", role: .cancel) {}
                } else {
                    Button("Delete Workspace", role: .destructive) {
                        Task { await manager.confirmDelete() }
                    }
                    .accessibilityIdentifier("pica.deleteWorkspace.confirm")
                    Button("Cancel", role: .cancel) {}
                }
            } message: { deletion in
                Text(deletion.message)
            }
            .alert(
                "Couldn’t delete the workspace", isPresented: present(\.deleteProblem), presenting: manager.deleteProblem
            ) { _ in
                Button("OK", role: .cancel) {}
            } message: { problem in
                Text(problem.message)
            }
    }

    private func present<Value>(_ keyPath: ReferenceWritableKeyPath<WorkspaceManager, Value?>) -> Binding<Bool> {
        Binding(
            get: { manager[keyPath: keyPath] != nil },
            set: { if !$0 { manager[keyPath: keyPath] = nil } })
    }
}
