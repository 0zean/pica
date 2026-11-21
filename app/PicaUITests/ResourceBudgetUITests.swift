import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md §9 (H-07): with five sessions of 2,000 events each, the app uses under 1% of a core while they are idle and
/// under 300 MB of memory. Each session plays the `resources` scenario, whose first turn writes about 2,000 events;
/// the test opens every one in the main window, so each timeline has been loaded, and then leaves the app alone.
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
        let pica = try PicaUnderTest(scenario: "resources")
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
            try open(session, in: app, pica: pica)
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

    /// Selects the session in the sidebar and waits until its timeline has applied every event.
    @MainActor
    private func open(_ session: Session, in app: XCUIApplication, pica: PicaUnderTest) throws {
        try? FileManager.default.removeItem(atPath: pica.timelineMetricsPath)
        let row = app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "session \(session.id) is not in the sidebar")
        row.click()
        let path = pica.timelineMetricsPath
        waitUntil("session \(session.id)'s timeline is open", timeout: 20) {
            guard let report = try? JSONDecoder().decode(TimelineMetricsReport.self, from: Data(contentsOf: URL(filePath: path)))
            else { return false }
            return report.sessionId == session.id && report.openSeconds != nil && report.lastSeq >= session.lastSeq
        }
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
