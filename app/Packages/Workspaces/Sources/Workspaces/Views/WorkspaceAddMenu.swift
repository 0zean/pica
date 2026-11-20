import PicaProtocol
import SwiftUI

/// The sidebar toolbar's add menu: a new workspace, or a repo or teams for the workspace the selection is in.
public struct WorkspaceAddMenu: View {
    let manager: WorkspaceManager
    /// The workspace the sidebar's selection belongs to, else the only one.
    let workspaceId: @MainActor () -> Id?

    public init(manager: WorkspaceManager, workspaceId: @escaping @MainActor () -> Id?) {
        self.manager = manager
        self.workspaceId = workspaceId
    }

    public var body: some View {
        Menu {
            Button("New Workspace…") { manager.presentNewWorkspace() }
                .accessibilityIdentifier("pica.sidebar.add.newWorkspace")
            let target = workspaceId()
            Button("Add Repository…") {
                if let target { manager.presentAddRepository(workspaceId: target) }
            }
            .disabled(target == nil)
            .accessibilityIdentifier("pica.sidebar.add.repository")
            Button("Import GitHub Teams…") {
                if let target { manager.presentTeamBrowser(workspaceId: target) }
            }
            .disabled(target == nil)
            .accessibilityIdentifier("pica.sidebar.add.teams")
        } label: {
            Label("Add", systemImage: "plus")
        }
        .help("New workspace, add a repository, or import GitHub teams")
        .accessibilityIdentifier("pica.sidebar.add")
    }
}
