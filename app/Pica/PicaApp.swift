import AppKit
import AppShell
import Composer
import DesignSystem
import EngineClient
import Files
import PicaProtocol
import PicaSettings
import Review
import SwiftUI
import Timeline

@main
struct PicaApp: App {
    @State private var launch: AppLaunch
    /// The action registry, ⌘K palette, keybindings and Settings (A-14).
    private let actions: AppActions
    /// Set only when the UI tests ask for the timeline's performance (`PICA_TIMELINE_METRICS_PATH`).
    private let timelineMetrics = TimelineMetrics(environment: ProcessInfo.processInfo.environment)
    /// Set only when the UI tests ask for the composer's keystroke latency (`PICA_COMPOSER_METRICS_PATH`).
    private let composerMetrics = ComposerMetrics(environment: ProcessInfo.processInfo.environment)
    /// Set only when the UI tests ask how long a diff took to draw (`PICA_REVIEW_METRICS_PATH`).
    private let reviewMetrics = ReviewMetrics(environment: ProcessInfo.processInfo.environment)
    /// Unsent composer text per session, kept while the app runs.
    private let drafts = ComposerDrafts()
    /// ⌘P over the main window (A-09).
    @State private var quickOpen: QuickOpen
    /// Opens files in the user's editor; UI tests log the paths instead (`PICA_EXTERNAL_EDITOR_LOG`).
    private let editor = ExternalEditor.system(environment: ProcessInfo.processInfo.environment)

    init() {
        guard let launch = AppLaunch.begin() else {
            // Another copy of Pica is running and has been brought to the front.
            exit(0)
        }
        _launch = State(initialValue: launch)
        _quickOpen = State(initialValue: QuickOpen(client: launch.model.client))
        actions = AppActions(client: launch.model.client, navigation: launch.navigation)
        launch.model.start()
        launch.navigation.start()
    }

    var body: some Scene {
        Window("Pica", id: "main") {
            RootView(
                model: launch.model, navigation: launch.navigation, sessionContent: sessionTimeline,
                inspectorPanes: inspectorPanes, onInteractive: launch.windowBecameInteractive)
                .modifier(ActionHost(actions: actions))
                .overlay {
                    if quickOpen.isPresented {
                        ZStack {
                            Color.black.opacity(0.001).onTapGesture { quickOpen.dismiss() }
                            QuickOpenPanel(quickOpen: quickOpen, editor: editor)
                        }
                    }
                }
        }
        .commands {
            ActionCommands(registry: actions.registry, keybindings: actions.keybindings)
            NavigationCommands(store: launch.navigation)
            QuickOpenCommands(present: presentQuickOpen)
        }

        Settings {
            SettingsView(
                navigation: actions.settingsNavigation, settings: actions.settings, keybindings: actions.keybindings,
                registry: actions.registry)
        }

        // A-09: the read-only viewer, one window per file.
        WindowGroup("File", id: FileViewerScreen.windowId, for: FileReference.self) { $reference in
            if let reference {
                FileViewerScreen(reference: reference, client: launch.model.client, editor: editor)
            }
        }
        .defaultSize(width: 760, height: 640)
    }

    /// The inspector's panes, one per feature (A-09 Files).
    private var inspectorPanes: [InspectorPane] {
        [
            InspectorPane(id: "files", title: "Files", systemImage: "folder") { [editor] context in
                guard let workspaceId = context.workspaceId else {
                    return AnyView(EmptyState("No workspace", message: "Select a workspace to browse its files."))
                }
                return AnyView(FileTreeView(workspaceId: workspaceId, client: context.client, editor: editor))
            },
        ]
    }

    /// ⌘P searches the selected item's workspace, or the only workspace there is.
    private func presentQuickOpen() {
        let navigation = launch.navigation
        let workspaceId = navigation.selection.flatMap(navigation.workspaceId(of:))
            ?? (navigation.workspaces.count == 1 ? navigation.workspaces.first?.id : nil)
        quickOpen.present(workspaceId: workspaceId, repos: workspaceId.flatMap { navigation.reposByWorkspace[$0] } ?? [])
    }

    /// The timeline (A-05) and the composer under it (A-06) in the session column, or the review of the session's
    /// changes (A-08) in their place. Features meet only here, in the app target (PLAN.md §4.3).
    private func sessionTimeline(_ session: Session, client: EngineClient) -> AnyView {
        AnyView(
            SessionDetail(session: session) {
                VStack(spacing: 0) {
                    SessionTimelineScreen(
                        sessionId: session.id, title: session.displayTitle, historySeq: session.lastSeq, client: client
                    )
                    .environment(timelineMetrics)
                    SessionComposer(session: session, client: client, drafts: drafts)
                        .environment(composerMetrics)
                }
            } review: {
                SessionReview(session: session, client: client)
                    .environment(reviewMetrics)
            })
    }
}

/// The session column's two views, switched from the toolbar or with ⇧⌘R: the conversation, and the review of what
/// the session changed.
private struct SessionDetail<Conversation: View, Changes: View>: View {
    let session: Session
    @ViewBuilder let conversation: Conversation
    @ViewBuilder let review: Changes
    @State private var reviewing = false

    var body: some View {
        Group {
            if reviewing {
                review
            } else {
                conversation
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Toggle(isOn: $reviewing) {
                    Label("Review Changes", systemImage: "plusminus")
                }
                .toggleStyle(.button)
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .help(reviewing ? "Back to the Conversation (⇧⌘R)" : "Review Changes (⇧⌘R)")
                .accessibilityIdentifier("pica.toolbar.review")
            }
        }
    }
}
