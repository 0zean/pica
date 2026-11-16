import AppKit
import AppShell
import SwiftUI

@main
struct PicaApp: App {
    @State private var launch: AppLaunch

    init() {
        guard let launch = AppLaunch.begin() else {
            // Another copy of Pica is running and has been brought to the front.
            exit(0)
        }
        _launch = State(initialValue: launch)
        launch.model.start()
    }

    var body: some Scene {
        Window("Pica", id: "main") {
            RootView(model: launch.model, onInteractive: launch.windowBecameInteractive)
        }
    }
}
