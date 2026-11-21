import Foundation
import Observation
import Sparkle

/// Sparkle's updater for the running app (H-06). Sparkle checks the appcast, verifies each update's EdDSA signature
/// against `SUPublicEDKey`, and replaces the bundle; a build without a key never starts it.
@MainActor
@Observable
public final class AppUpdater {
    public let configuration: UpdateConfiguration
    public private(set) var canCheckForUpdates = false
    @ObservationIgnored private let controller: SPUStandardUpdaterController?
    @ObservationIgnored private var observation: NSKeyValueObservation?

    public init(bundle: Bundle = .main) {
        configuration = UpdateConfiguration(infoDictionary: bundle.infoDictionary ?? [:])
        guard configuration.isEnabled else {
            controller = nil
            return
        }
        let controller = SPUStandardUpdaterController(
            startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        self.controller = controller
        observation = controller.updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { [weak self] _, change in
            let canCheck = change.newValue ?? false
            Task { @MainActor in self?.canCheckForUpdates = canCheck }
        }
    }

    public var isEnabled: Bool { controller != nil }

    public func checkForUpdates() {
        controller?.checkForUpdates(nil)
    }
}
