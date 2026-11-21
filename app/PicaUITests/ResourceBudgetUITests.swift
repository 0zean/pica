import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md §9 (H-07): with five sessions of 2,000 events each, the app uses under 1% of a core while they are idle and
/// under 300 MB of memory. Each session plays the `resources` scenario, whose first turn writes about 2,000 events;
/// the test opens every one in the main window, so each timeline has been loaded, and then leaves the app alone. The
/// timeline's and composer's frame metrics are off: each runs a display link on every frame, which is the tests'
/// cost, not the app's.
///
/// Pica measures itself (`ResourceMetrics`): its own CPU time over a window, and its physical footprint, which is what
/// Activity Monitor's Memory column shows. The engine is another process and is not counted. Accessibility queries
/// cost Pica CPU, so nothing touches the app while it measures.
final class ResourceBudgetUITests: XCTestCase {
    private static let sessions = 5
    private static let eventsPerSession = 2_000
    private static let idleCPUBudget = 0.01
    private static let memoryBudgetBytes: UInt64 = 300 * 1024 * 1024
    private static let settleSeconds = 3.0
    private static let windowSeconds = 10.0

    @MainActor
    func testFiveSessionsOfTwoThousandEventsStayUnderTheIdleCPUAndMemoryBudgets() throws {
        let pica = try PicaUnderTest(scenario: "resources", frameMetrics: false)
        defer { pica.remove() }
        let app = pica.launch()
        let path = try pica.makeRepository("atlas")
        let sessions = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            let repo = try await engine.addRepo(at: path, to: workspace)
            var sessions: [Session] = []
            for _ in 0..<Self.sessions {
                let created = try await engine.createSession(in: workspace, writing: repo, prompt: "go")
                sessions.append(try await engine.waitUntilIdle(created.id))
            }
            return sessions
        }
        for session in sessions {
            XCTAssertGreaterThanOrEqual(session.lastSeq, Self.eventsPerSession, "session \(session.id) is too small")
            XCTAssertTrue(
                app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"].waitForExistence(timeout: 10),
                "session \(session.id) is not in the sidebar")
        }
        for number in 1...sessions.count {
            open(number, in: app)
        }

        // Let the last timeline settle, then ask Pica to measure; nothing here touches the app until the report exists.
        RunLoop.current.run(until: Date().addingTimeInterval(Self.settleSeconds))
        let reportPath = pica.resourceMetricsPath
        try Data(String(Self.windowSeconds).utf8).write(to: URL(filePath: reportPath + ".request"))
        var report: ResourceReport?
        let deadline = Date().addingTimeInterval(Self.windowSeconds + 20)
        while report == nil, Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            report = try? JSONDecoder().decode(ResourceReport.self, from: Data(contentsOf: URL(filePath: reportPath)))
        }
        let measured = try XCTUnwrap(report, "Pica did not report its CPU use and memory")
        let megabytes = { (bytes: UInt64) in Double(bytes) / 1_048_576 }
        let summary = String(
            format: "%d sessions, %d events: CPU %.3f%% of a core over %.1f s; footprint %.1f MB, peak %.1f MB",
            sessions.count, sessions.map(\.lastSeq).reduce(0, +), measured.cpuFraction * 100, measured.wallSeconds,
            megabytes(measured.footprintBytes), megabytes(measured.peakFootprintBytes))
        print("H-07 resources:", summary)
        let attachment = XCTAttachment(string: summary)
        attachment.lifetime = .keepAlways
        add(attachment)
        recordBudget(BudgetMeasurement(
            id: "idle-cpu", measured: measured.cpuFraction * 100, threshold: Self.idleCPUBudget * 100, unit: "%"))
        recordBudget(BudgetMeasurement(
            id: "memory", measured: megabytes(measured.footprintBytes), threshold: megabytes(Self.memoryBudgetBytes),
            unit: "MB"))

        XCTAssertGreaterThanOrEqual(measured.wallSeconds, Self.windowSeconds - 0.1)
        XCTAssertLessThan(measured.cpuFraction, Self.idleCPUBudget, summary)
        XCTAssertLessThan(measured.footprintBytes, Self.memoryBudgetBytes, summary)
        pica.quit(app)
    }

    /// Selects the `number`th session in sidebar order with ⌘<number>, as a user would (a click can miss a sidebar row
    /// that is scrolled or covered), and waits until a timeline is on screen. A 2,000-event session opens in well under
    /// the 300 ms §9 allows a 10,000-event one; the wait after it covers that.
    @MainActor
    private func open(_ number: Int, in app: XCUIApplication) {
        app.typeKey(String(number), modifierFlags: .command)
        XCTAssertTrue(app.descendants(matching: .any)["pica.timeline.list"].waitForExistence(timeout: 10), "no timeline is shown")
        RunLoop.current.run(until: Date().addingTimeInterval(1))
    }
}

/// The part of Pica's `ResourceMetrics.Report` the test reads.
private struct ResourceReport: Decodable {
    var cpuSeconds: Double
    var wallSeconds: Double
    var cpuFraction: Double
    var footprintBytes: UInt64
    var peakFootprintBytes: UInt64
}
