import AppKit
import EngineClient
import Foundation

/// Everything the app sets up at launch: the single-instance lock, the engine supervisor, and the stores.
@MainActor
public final class AppLaunch {
    public let model: AppModel
    public let navigation: NavigationStore
    /// Notifies of sessions waiting for approval while Pica is in the background (A-07).
    public let approvalNotifier: ApprovalNotifier?
    /// Where the engine's `secrets.*` requests are answered, and where features store secrets the user enters (A-13).
    public let secrets: any SecretBroker
    private let lock: SingleInstanceLock?
    private let launchMetricsPath: String?
    private var recordedInteractive = false

    private init(
        model: AppModel, navigation: NavigationStore, approvalNotifier: ApprovalNotifier?, secrets: any SecretBroker,
        lock: SingleInstanceLock?, launchMetricsPath: String?
    ) {
        self.model = model
        self.navigation = navigation
        self.approvalNotifier = approvalNotifier
        self.secrets = secrets
        self.lock = lock
        self.launchMetricsPath = launchMetricsPath
    }

    /// The socket `picad` listens on: `PICA_SOCKET` when set (as `picad` itself reads it), else the default the CLI also uses.
    /// The lock, `picad.log` and `window-state.json` sit next to it.
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
        let secrets: any SecretBroker = environment["PICA_SECRETS"] == "memory" ? InMemorySecretBroker() : KeychainSecretBroker()
        let supervisor = EngineSupervisor(
            command: EngineCommand.resolve(environment: environment, bundle: bundle),
            socketPath: socket,
            secrets: secrets,
            clientConfiguration: clientConfiguration)
        let model = AppModel(supervisor: supervisor)
        let stateFile = WindowStateFile(url: URL(filePath: socket).deletingLastPathComponent().appending(path: "window-state.json"))
        let navigation = NavigationStore(client: supervisor.client, stateFile: stateFile)
        NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { navigation.saveNow() }
            supervisor.terminateEngine()
        }
        let approvalNotifier = ApprovalNotifier.live(client: supervisor.client, navigation: navigation, environment: environment)
        return AppLaunch(
            model: model, navigation: navigation, approvalNotifier: approvalNotifier, secrets: secrets, lock: lock,
            launchMetricsPath: environment["PICA_LAUNCH_METRICS_PATH"])
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
