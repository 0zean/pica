import SwiftUI

/// Presents the manager's sheet, and its delete confirmation, over the main window, so the registry's actions open
/// them whatever is selected.
public struct WorkspaceSheets: ViewModifier {
    let manager: WorkspaceManager

    public init(manager: WorkspaceManager) {
        self.manager = manager
    }

    public func body(content: Content) -> some View {
        @Bindable var manager = manager
        content.sheet(item: $manager.sheet) { sheet in
            switch sheet {
            case .newWorkspace:
                NewWorkspaceSheet(manager: manager)
            case .addRepository(let workspaceId):
                AddRepositorySheet(workspace: manager.store(for: workspaceId), manager: manager)
            case .importTeams(let workspaceId):
                TeamBrowserSheet(workspace: manager.store(for: workspaceId), manager: manager)
            case .newSession:
                if let store = manager.newSession {
                    NewSessionSheet(store: store, manager: manager)
                }
            case .renameWorkspace(let workspaceId):
                RenameWorkspaceSheet(manager: manager, workspaceId: workspaceId)
            }
        }
        .modifier(WorkspaceDeletionAlerts(manager: manager))
    }
}
