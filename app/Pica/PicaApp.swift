import AppKit
import AppShell
import Composer
import EngineClient
import PicaProtocol
import PicaSettings
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
    /// Unsent composer text per session, kept while the app runs.
    private let drafts = ComposerDrafts()

    init() {
        guard let launch = AppLaunch.begin() else {
            // Another copy of Pica is running and has been brought to the front.
            exit(0)
        }
        _launch = State(initialValue: launch)
        actions = AppActions(client: launch.model.client, navigation: launch.navigation)
        launch.model.start()
        launch.navigation.start()
    }

    var body: some Scene {
        Window("Pica", id: "main") {
            RootView(
                model: launch.model, navigation: launch.navigation, sessionContent: sessionTimeline,
                onInteractive: launch.windowBecameInteractive)
            .modifier(ActionHost(actions: actions))
        }
        .commands {
            ActionCommands(registry: actions.registry, keybindings: actions.keybindings)
            NavigationCommands(store: launch.navigation)
        }
        Settings {
            SettingsView(
                navigation: actions.settingsNavigation, settings: actions.settings, keybindings: actions.keybindings,
                registry: actions.registry)
        }
    }

    /// The timeline (A-05) and the composer under it (A-06) in the session column. Features meet only here, in the
    /// app target (PLAN.md §4.3).
    private func sessionTimeline(_ session: Session, client: EngineClient) -> AnyView {
        AnyView(
            VStack(spacing: 0) {
                SessionTimelineScreen(sessionId: session.id, title: session.displayTitle, historySeq: session.lastSeq, client: client)
                    .environment(timelineMetrics)
                SessionComposer(session: session, client: client, drafts: drafts)
                    .environment(composerMetrics)
            })
    }
}
