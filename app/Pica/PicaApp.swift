import AppKit
import AppShell
import EngineClient
import PicaProtocol
import SwiftUI
import Timeline

@main
struct PicaApp: App {
    @State private var launch: AppLaunch
    /// Set only when the UI tests ask for the timeline's performance (`PICA_TIMELINE_METRICS_PATH`).
    private let timelineMetrics = TimelineMetrics(environment: ProcessInfo.processInfo.environment)

    init() {
        guard let launch = AppLaunch.begin() else {
            // Another copy of Pica is running and has been brought to the front.
            exit(0)
        }
        _launch = State(initialValue: launch)
        launch.model.start()
        launch.navigation.start()
    }

    var body: some Scene {
        Window("Pica", id: "main") {
            RootView(
                model: launch.model, navigation: launch.navigation, sessionContent: sessionTimeline,
                onInteractive: launch.windowBecameInteractive)
        }
        .commands {
            SidebarCommands()
            NavigationCommands(store: launch.navigation)
        }
    }

    /// The timeline (A-05) in the session column. Features meet only here, in the app target (PLAN.md §4.3).
    private func sessionTimeline(_ session: Session, client: EngineClient) -> AnyView {
        AnyView(
            SessionTimelineScreen(sessionId: session.id, title: session.displayTitle, historySeq: session.lastSeq, client: client)
                .environment(timelineMetrics))
    }
}
