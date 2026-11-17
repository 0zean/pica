import EngineClient
import EngineClientTestSupport
import Foundation
import PicaProtocol
import XCTest

/// One Pica data directory and socket, launched as often as a test needs against `picad` with a FakeRuntime
/// (`engine/packages/server/tests/processes/fake-picad.ts`). Relaunching reuses the directory, so the engine's store
/// and the window state carry over, as they do for a user.
@MainActor
final class PicaUnderTest {
    static let repository = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()
    /// The `fake-picad.ts` Pica starts. `make app-ui-test-pica` passes a copy of `engine/` outside ~/Documents as
    /// TEST_RUNNER_PICA_UI_TEST_ENGINE (`tools/ui-tests/stage-engine.sh`): Node runs as Pica's child, so reading a
    /// checkout under ~/Documents would make macOS ask each rebuilt Pica for the Documents folder.
    static var fakePicad: URL {
        let engine = ProcessInfo.processInfo.environment["PICA_UI_TEST_ENGINE"].map { URL(filePath: $0) }
            ?? repository.appending(path: "engine")
        return engine.appending(path: "packages/server/tests/processes/fake-picad.ts")
    }

    let name: String
    /// In the runner's own temporary directory, because the runner is sandboxed and Pica must be able to write there.
    let home: URL
    /// Also in the runner's temporary directory: the sandbox lets the runner connect only to sockets in its container.
    let socketPath: String
    /// The FakeRuntime scenario in `fake-picad-scenarios.ts` that sessions play.
    let scenario: String
    /// Where Pica writes `TimelineMetrics`' report.
    let timelineMetricsPath: String
    /// Where Pica writes `ComposerMetrics`' report.
    let composerMetricsPath: String
    /// Where Pica writes `ReviewMetrics`' reports.
    let reviewMetricsPath: String
    private let scrollScript: Bool
    /// A-14: a managed policy (docs/managed-policy.md) `fake-picad` loads as if root owned it.
    private let managedPolicy: String?
    private let node: String

    init(scenario: String = "empty", scrollScript: Bool = false, managedPolicy: String? = nil) throws {
        self.scenario = scenario
        self.scrollScript = scrollScript
        self.managedPolicy = managedPolicy
        // `make app-ui-test` passes this as TEST_RUNNER_PICA_NODE.
        node = try XCTUnwrap(ProcessInfo.processInfo.environment["PICA_NODE"], "set PICA_NODE to a Node 22 executable")
        name = "pica-ui-\(UUID().uuidString.prefix(8))"
        home = FileManager.default.temporaryDirectory.appending(path: name)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        socketPath = home.appending(path: "picad.sock").path
        timelineMetricsPath = home.appending(path: "timeline-metrics.json").path
        composerMetricsPath = home.appending(path: "composer-metrics.json").path
        reviewMetricsPath = home.appending(path: "review-metrics.json").path
        XCTAssertLessThan(socketPath.utf8.count, 104, "\(socketPath) is longer than sun_path allows")
        if let managedPolicy {
            try Data(managedPolicy.utf8).write(to: policyFile)
        }
    }

    var policyFile: URL { home.appending(path: "policy.jsonc") }

    /// The user layer `config.set` writes.
    var configFile: URL { home.appending(path: "Library/Application Support/Pica/config.jsonc") }

    var environment: [String: String] {
        var environment = [
            "PICA_NODE": node,
            "PICA_ENGINE_ENTRY": Self.fakePicad.path,
            "PICA_TEST_HOME": home.path,
            "PICA_SOCKET": socketPath,
            "PICA_TEST_SCENARIO": scenario,
            "PICA_TIMELINE_METRICS_PATH": timelineMetricsPath,
            "PICA_COMPOSER_METRICS_PATH": composerMetricsPath,
            "PICA_REVIEW_METRICS_PATH": reviewMetricsPath,
            // A-07: no system notifications, so no test meets the permission prompt.
            "PICA_NOTIFICATIONS": "off",
        ]
        if scrollScript {
            environment["PICA_TIMELINE_SCROLL_SCRIPT"] = "1"
        }
        if managedPolicy != nil {
            environment["PICA_TEST_MANAGED_POLICY"] = policyFile.path
        }
        return environment
    }

    /// Launches Pica and waits until it is connected to its engine.
    func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = environment
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10), "the main window did not appear")
        let banner = app.descendants(matching: .any)["pica.engineStatus"]
        // The first launch of a freshly built Pica can take several seconds longer while macOS checks the new binary.
        waitUntil("the engine is connected", timeout: 30) { !banner.exists }
        return app
    }

    /// Quits with ⌘Q, as a user would, so Pica stops its engine and saves the window.
    func quit(_ app: XCUIApplication) {
        app.typeKey("q", modifierFlags: .command)
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 10), "Pica did not quit")
    }

    /// Runs `body` with a client of the engine Pica started, creating what the test needs the way any client would.
    /// It blocks until `body` is done: XCUITest's calls are synchronous, and an async test that fails an XCUITest
    /// call can hang in its tear-down.
    func withEngine<T: Sendable>(_ body: @escaping @Sendable (EngineClient) async throws -> T) throws -> T {
        let socketPath = socketPath
        let outcome = Outcome<T>()
        let done = DispatchSemaphore(value: 0)
        Task.detached {
            let client = EngineClient(socketPath: socketPath, secrets: InMemorySecretBroker())
            do {
                try await client.connect()
                outcome.set(.success(try await body(client)))
            } catch {
                outcome.set(.failure(error))
            }
            await client.close()
            done.signal()
        }
        done.wait()
        return try outcome.get()
    }

    /// An empty git repository with an `origin`, which `repo.addPath` accepts. The runner cannot run git, so the
    /// few files git needs are written by hand.
    func makeRepository(_ repoName: String) throws -> URL {
        let root = home.appending(path: "repos/\(repoName)")
        let git = root.appending(path: ".git")
        for directory in ["objects", "refs/heads"] {
            try FileManager.default.createDirectory(at: git.appending(path: directory), withIntermediateDirectories: true)
        }
        try Data("ref: refs/heads/main\n".utf8).write(to: git.appending(path: "HEAD"))
        let config = "[core]\n\trepositoryformatversion = 0\n\tbare = false\n[remote \"origin\"]\n\turl = https://git.example.com/acme/\(repoName).git\n"
        try Data(config.utf8).write(to: git.appending(path: "config"))
        return root
    }

    func remove() {
        try? FileManager.default.removeItem(at: home)
    }
}

private final class Outcome<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<T, any Error>?

    func set(_ result: Result<T, any Error>) {
        lock.withLock { self.result = result }
    }

    func get() throws -> T {
        try lock.withLock { result! }.get()
    }
}

/// Waits for `condition`, failing the test when it is still false after `timeout` seconds.
@MainActor
func waitUntil(_ description: String, timeout: TimeInterval, file: StaticString = #filePath, line: UInt = #line,
          _ condition: @escaping @MainActor () -> Bool) {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() {
        guard Date() < deadline else {
            XCTFail("timed out waiting until \(description)", file: file, line: line)
            return
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
}

extension EngineClient {
    func createWorkspace(_ name: String) async throws -> Workspace {
        try await request(Methods.WorkspaceCreate.self, WorkspaceCreateParams(name: name)).workspace
    }

    /// Registers the repository at `path` and pins it to `workspace`.
    func addRepo(at path: URL, to workspace: Workspace) async throws -> Repo {
        let repo = try await request(Methods.RepoAddPath.self, RepoAddPathParams(path: path.path)).repo
        _ = try await request(Methods.WorkspacePinRepo.self, WorkspacePinRepoParams(workspaceId: workspace.id, repoId: repo.id))
        return repo
    }

    func createSession(in workspace: Workspace, writing repo: Repo, prompt: String? = nil) async throws -> Session {
        try await request(
            Methods.SessionCreate.self,
            SessionCreateParams(workspaceId: workspace.id, writeRepoIds: [repo.id], referenceRepoIds: [], prompt: prompt)
        ).session
    }

    /// Waits until the session has finished its turn and returns it.
    func waitUntilIdle(_ sessionId: Id, timeout: Duration = .seconds(60)) async throws -> Session {
        let deadline = ContinuousClock.now + timeout
        while true {
            let session = try await request(Methods.SessionGet.self, BySession(sessionId: sessionId)).session
            if session.state == .idle { return session }
            guard ContinuousClock.now < deadline else { throw WaitError.timedOut(session.state) }
            try await Task.sleep(for: .milliseconds(100))
        }
    }

    func send(_ text: String, to sessionId: Id) async throws {
        let accepted = try await request(
            Methods.SessionSend.self, SessionSendParams(sessionId: sessionId, text: text, mode: .send)).accepted
        guard accepted else { throw WaitError.notAccepted }
    }
}

enum WaitError: Error {
    case timedOut(SessionState)
    case notAccepted
}
