import PicaProtocol
import SwiftUI

/// The sidebar toolbar's add menu: a new session, repo or teams for the workspace the selection is in, or a new
/// workspace.
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
            let target = workspaceId()
            Button("New Session…") {
                if let target { manager.presentNewSession(workspaceId: target) }
            }
            .disabled(manager.newSessionUnavailableReason(workspaceId: target) != nil)
            .help(manager.newSessionUnavailableReason(workspaceId: target) ?? "Start a session in this workspace")
            .accessibilityIdentifier("pica.sidebar.add.newSession")
            Divider()
            Button("New Workspace…") { manager.presentNewWorkspace() }
                .accessibilityIdentifier("pica.sidebar.add.newWorkspace")
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
        .help("New session or workspace, add a repository, or import GitHub teams")
        .accessibilityIdentifier("pica.sidebar.add")
    }
}
