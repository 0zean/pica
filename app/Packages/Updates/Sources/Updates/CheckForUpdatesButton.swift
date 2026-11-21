import SwiftUI

/// "Check for Updates…" for the app menu. Hidden in builds that cannot update (no EdDSA key or feed).
public struct CheckForUpdatesButton: View {
    private let updater: AppUpdater

    public init(updater: AppUpdater) {
        self.updater = updater
    }

    public var body: some View {
        if updater.isEnabled {
            Button("Check for Updates…") { updater.checkForUpdates() }
                .disabled(!updater.canCheckForUpdates)
        }
    }
}
