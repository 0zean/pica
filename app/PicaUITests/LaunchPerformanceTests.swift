import XCTest

/// PLAN.md A-01 and §9: cold launch to interactive window is under 1.0 s, and no slower than the recorded baseline allows.
///
/// Each run starts a new Pica process with its own data and socket directory, against `picad` with a FakeRuntime.
/// The app reports the time from the kernel's process start to the first run-loop turn after its window appeared
/// (`LaunchTiming`); the test also checks that the window is really there and hittable.
final class LaunchPerformanceTests: XCTestCase {
    private struct Baseline: Decodable {
        var medianSeconds: Double
        var toleranceSeconds: Double
    }

    private static let budgetSeconds = 1.0
    private static let runs = 5
    private static let repository = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()

    @MainActor
    func testColdLaunchToInteractiveWindowIsUnderBudgetAndBaseline() throws {
        // `make app-ui-test` passes these as TEST_RUNNER_PICA_NODE.
        let node = try XCTUnwrap(ProcessInfo.processInfo.environment["PICA_NODE"], "set PICA_NODE to a Node 22 executable")
        let entry = Self.repository.appending(path: "engine/packages/server/tests/processes/fake-picad.ts")
        var samples: [Double] = []
        for run in 0..<Self.runs {
            samples.append(try launchOnce(node: node, entry: entry, waitForEngine: run == 0))
        }
        samples.sort()
        let median = samples[samples.count / 2]
        let baseline = try JSONDecoder().decode(
            Baseline.self,
            from: Data(contentsOf: Self.repository.appending(path: "app/PicaUITests/LaunchBaseline.json")))
        let report = XCTAttachment(string: "launch to interactive (s): \(samples), median \(median), baseline \(baseline.medianSeconds)")
        report.lifetime = .keepAlways
        add(report)

        XCTAssertLessThan(median, Self.budgetSeconds, "median cold launch \(median) s is over the 1.0 s budget; samples \(samples)")
        XCTAssertLessThanOrEqual(
            median, baseline.medianSeconds + baseline.toleranceSeconds,
            "median cold launch \(median) s regressed past the baseline \(baseline.medianSeconds) s "
                + "+ \(baseline.toleranceSeconds) s; samples \(samples). Update LaunchBaseline.json only for an accepted change.")
    }

    /// Launches Pica once and returns its self-reported launch-to-interactive time in seconds.
    @MainActor
    private func launchOnce(node: String, entry: URL, waitForEngine: Bool) throws -> Double {
        // The runner is sandboxed, so the data directory and the report live in its own temporary directory, which
        // Pica can write to. The socket goes under /tmp to stay within sun_path's 104 bytes; Pica creates it.
        let name = "pica-ui-\(UUID().uuidString.prefix(8))"
        let home = FileManager.default.temporaryDirectory.appending(path: name)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: home) }
        let metrics = home.appending(path: "launch.json")

        let app = XCUIApplication()
        app.launchEnvironment = [
            "PICA_NODE": node,
            "PICA_ENGINE_ENTRY": entry.path,
            "PICA_TEST_HOME": home.path,
            "PICA_SOCKET": "/tmp/\(name)/picad.sock",
            "PICA_LAUNCH_METRICS_PATH": metrics.path,
        ]
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10), "the main window did not appear")
        XCTAssertTrue(window.isHittable, "the main window is not hittable")
        XCTAssertTrue(app.descendants(matching: .any)["pica.root"].exists, "the window does not show Pica's content")
        wait(for: [fileExists(metrics)], timeout: 10)
        if waitForEngine {
            // The window works against a real engine: the "Starting the engine…" banner goes away once connected.
            let banner = app.descendants(matching: .any)["pica.engineStatus"]
            let connected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: banner)
            wait(for: [connected], timeout: 10)
        }
        app.terminate()

        struct Report: Decodable { var launchToInteractiveSeconds: Double }
        return try JSONDecoder().decode(Report.self, from: Data(contentsOf: metrics)).launchToInteractiveSeconds
    }

    private func fileExists(_ url: URL) -> XCTestExpectation {
        XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in FileManager.default.fileExists(atPath: url.path) }, object: nil)
    }
}
