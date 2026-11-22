import DesignSystem
import PicaProtocol
import SwiftUI

/// The rename alert and the delete confirmation for `NavigationStore.pendingSessionAction`, and an alert for a
/// rename or delete the engine refused (docs/navigation-shell.md#renaming-and-deleting-sessions).
struct SessionActionDialogs: ViewModifier {
    @Bindable var store: NavigationStore
    @State private var draftTitle = ""

    func body(content: Content) -> some View {
        content
            .alert("Rename Session", isPresented: isPresented(rename: true), presenting: renaming) { session in
                TextField("Title", text: $draftTitle)
                    .accessibilityIdentifier("pica.renameSession.title")
                Button("Rename") {
                    let title = draftTitle
                    Task { await store.rename(session.id, to: title) }
                }
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("pica.renameSession.confirm")
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("Leave it empty to show the session as “Untitled session”.")
            }
            .alert(deleteTitle, isPresented: isPresented(rename: false), presenting: deleting) { session in
                Button("Delete", role: .destructive) {
                    Task { await store.delete(session.id) }
                }
                .accessibilityIdentifier("pica.deleteSession.confirm")
                Button("Cancel", role: .cancel) {}
            } message: { session in
                Text(Self.deleteMessage(session))
            }
            .alert(
                "Something went wrong", isPresented: failurePresented,
                actions: { Button("OK", role: .cancel) {} },
                message: { Text(store.sessionActionFailure ?? "") })
            .onChange(of: store.pendingSessionAction) { _, action in
                if case .rename(let id) = action {
                    draftTitle = store.sessionsById[id]?.title ?? ""
                }
            }
    }

    private var renaming: Session? {
        if case .rename(let id) = store.pendingSessionAction { store.sessionsById[id] } else { nil }
    }

    private var deleting: Session? {
        if case .delete(let id) = store.pendingSessionAction { store.sessionsById[id] } else { nil }
    }

    private var deleteTitle: String {
        "Delete “\(deleting?.displayTitle ?? "session")”?"
    }

    /// Names what is lost, and that a running turn is stopped first.
    static func deleteMessage(_ session: Session) -> String {
        var lines: [String] = []
        if SessionStatePresentation(session.state).isWorking || session.state == .awaitingApproval {
            lines.append("It is working now; deleting stops it first.")
        }
        lines.append(
            "Its timeline (messages, tool calls and agents), pending approvals and attached MCP servers are deleted. "
                + "This cannot be undone. Your repositories and their files are not touched, and its credits stay in "
                + "the usage totals.")
        return lines.joined(separator: " ")
    }

    private func isPresented(rename: Bool) -> Binding<Bool> {
        Binding(
            get: { (rename ? renaming : deleting) != nil },
            set: { presented in
                if !presented { store.pendingSessionAction = nil }
            })
    }

    private var failurePresented: Binding<Bool> {
        Binding(
            get: { store.sessionActionFailure != nil },
            set: { presented in
                if !presented { store.sessionActionFailure = nil }
            })
    }
}

extension View {
    func sessionActionDialogs(_ store: NavigationStore) -> some View {
        modifier(SessionActionDialogs(store: store))
    }
}

/// The session row's and the session title's menu items.
struct SessionActionMenuItems: View {
    let store: NavigationStore
    let sessionId: Id

    var body: some View {
        Button("Rename…") { store.beginRename(sessionId) }
            .accessibilityIdentifier("pica.sessionMenu.rename")
        Button("Delete…", role: .destructive) { store.beginDelete(sessionId) }
            .accessibilityIdentifier("pica.sessionMenu.delete")
    }
}
