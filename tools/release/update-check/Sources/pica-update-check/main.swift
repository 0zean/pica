// Usage: pica-update-check <installed Pica.app> <appcast URL>
// Checks the appcast for the app the way the app's own updater does (same SPUUpdater, same EdDSA and code-signing
// validation), accepts whatever it offers, installs it in place, and prints one JSON line with the outcome.
// Exit status: 0 installed, 1 refused or failed, 3 no update found.
import AppKit
import Foundation
@preconcurrency import Sparkle

let arguments = CommandLine.arguments
guard arguments.count == 3, let bundle = Bundle(path: arguments[1]), let feed = URL(string: arguments[2]) else {
    FileHandle.standardError.write(Data("usage: pica-update-check <Pica.app> <appcast URL>\n".utf8))
    exit(2)
}

@MainActor
func finish(_ outcome: String, _ status: Int32, error: Error? = nil, version: String? = nil) -> Never {
    var report: [String: Any] = ["outcome": outcome]
    if let error = error as NSError? {
        report["error"] = error.localizedDescription
        report["domain"] = error.domain
        report["code"] = error.code
        var causes: [String] = []
        var cause = error.userInfo[NSUnderlyingErrorKey] as? NSError
        while let current = cause {
            causes.append("\(current.domain) \(current.code): \(current.localizedDescription)")
            cause = current.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        if !causes.isEmpty { report["causes"] = causes }
    }
    if let version { report["offered"] = version }
    let data = (try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])) ?? Data()
    FileHandle.standardOutput.write(data + Data("\n".utf8))
    exit(status)
}

@MainActor
final class Delegate: NSObject, SPUUpdaterDelegate {
    let feed: URL
    var offered: String?

    init(feed: URL) {
        self.feed = feed
    }

    nonisolated func feedURLString(for updater: SPUUpdater) -> String? {
        MainActor.assumeIsolated { feed.absoluteString }
    }

    nonisolated func updaterShouldRelaunchApplication(_ updater: SPUUpdater) -> Bool { false }
}

@MainActor
final class Driver: NSObject, SPUUserDriver {
    let delegate: Delegate

    init(delegate: Delegate) {
        self.delegate = delegate
    }

    func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
        reply(SUUpdatePermissionResponse(automaticUpdateChecks: false, sendSystemProfile: false))
    }

    func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {}

    func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) {
        delegate.offered = appcastItem.displayVersionString
        reply(.install)
    }

    func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}
    func showUpdateReleaseNotesFailedToDownloadWithError(_ error: any Error) {}

    func showUpdateNotFoundWithError(_ error: any Error, acknowledgement: @escaping () -> Void) {
        finish("not_found", 3, error: error)
    }

    func showUpdaterError(_ error: any Error, acknowledgement: @escaping () -> Void) {
        finish("refused", 1, error: error, version: delegate.offered)
    }

    func showDownloadInitiated(cancellation: @escaping () -> Void) {}
    func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {}
    func showDownloadDidReceiveData(ofLength length: UInt64) {}
    func showDownloadDidStartExtractingUpdate() {}
    func showExtractionReceivedProgress(_ progress: Double) {}

    func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
        reply(.install)
    }

    func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void) {}

    func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
        finish("installed", 0, version: delegate.offered)
    }

    func showUpdateInFocus() {}
    func dismissUpdateInstallation() {}
}

MainActor.assumeIsolated {
    let delegate = Delegate(feed: feed)
    let driver = Driver(delegate: delegate)
    let updater = SPUUpdater(hostBundle: bundle, applicationBundle: bundle, userDriver: driver, delegate: delegate)
    do {
        try updater.start()
    } catch {
        finish("start_failed", 1, error: error)
    }
    updater.checkForUpdates()
    // Keep the updater and its delegates alive for the run loop.
    withExtendedLifetime((updater, driver, delegate)) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { finish("timed_out", 1) }
        NSApplication.shared.setActivationPolicy(.prohibited)
        RunLoop.main.run()
    }
}
