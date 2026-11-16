import AppKit
import EngineClient
import Foundation

/// Everything the app sets up at launch: the single-instance lock, the engine supervisor, and the store.
@MainActor
public final class AppLaunch {
    public let model: AppModel
    private let lock: SingleInstanceLock?
    private let launchMetricsPath: String?
    private var recordedInteractive = false

    private init(model: AppModel, lock: SingleInstanceLock?, launchMetricsPath: String?) {
        self.model = model
        self.lock = lock
        self.launchMetricsPath = launchMetricsPath
    }

    /// The socket `picad` listens on: `PICA_SOCKET` when set (as `picad` itself reads it), else the default the CLI also uses.
    /// The lock and `picad.log` sit next to it.
    public static func socketPath(environment: [String: String]) -> String {
        environment["PICA_SOCKET"]
            ?? URL.applicationSupportDirectory.appending(path: "Pica/run/picad.sock").path
    }

    /// Sets the app up, or returns nil after activating the copy of Pica that is already running.
    public static func begin(
        environment: [String: String] = ProcessInfo.processInfo.environment, bundle: Bundle = .main
    ) -> AppLaunch? {
        let socket = socketPath(environment: environment)
        let runDirectory = URL(filePath: socket).deletingLastPathComponent()
        let lock: SingleInstanceLock
        do {
            guard let acquired = try SingleInstanceLock.acquire(at: runDirectory.appending(path: "app.lock")) else {
                activateRunningCopy(bundle: bundle)
                return nil
            }
            lock = acquired
        } catch {
            // Without a lock file a second copy cannot be detected; running anyway is better than not starting.
            return begin(socket: socket, lock: nil, environment: environment, bundle: bundle)
        }
        return begin(socket: socket, lock: lock, environment: environment, bundle: bundle)
    }

    private static func begin(
        socket: String, lock: SingleInstanceLock?, environment: [String: String], bundle: Bundle
    ) -> AppLaunch? {
        var clientConfiguration = EngineSupervisor.clientConfiguration()
        clientConfiguration.clientVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let supervisor = EngineSupervisor(
            command: EngineCommand.resolve(environment: environment, bundle: bundle),
            socketPath: socket,
            secrets: KeychainSecretBroker(),
            clientConfiguration: clientConfiguration)
        let model = AppModel(supervisor: supervisor)
        NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification, object: nil, queue: nil
        ) { _ in
            supervisor.terminateEngine()
        }
        return AppLaunch(model: model, lock: lock, launchMetricsPath: environment["PICA_LAUNCH_METRICS_PATH"])
    }

    /// Called once the main window can take input; records launch timing when the performance test asks for it.
    public func windowBecameInteractive() {
        guard !recordedInteractive else { return }
        recordedInteractive = true
        if let launchMetricsPath {
            LaunchTiming.record(to: launchMetricsPath)
        }
    }

    private static func activateRunningCopy(bundle: Bundle) {
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundle.bundleIdentifier ?? "")
            .filter { $0 != NSRunningApplication.current }
        others.first?.activate()
    }
}
