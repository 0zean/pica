import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-05 and §9: a 10,000-event session opens in under 300 ms, scrolls with a hitch time ratio under 1%, and
/// streaming does not move the timeline while the user has scrolled up. The session plays the `timeline` scenario of
/// `fake-picad-scenarios.ts`: its first turn writes about 10,000 events, later turns stream a little more.
///
/// Pica measures itself (`TimelineMetrics`, docs/session-timeline.md) and writes the report this test reads.
final class TimelineUITests: XCTestCase {
    private static let openBudgetSeconds = 0.3
    private static let hitchRatioBudget = 0.01
    private static let opens = 5

    @MainActor
    func testATenThousandEventSessionOpensInUnder300Milliseconds() throws {
        let fixture = try TimelineFixture()
        defer { fixture.remove() }
        var samples: [Double] = []
        for _ in 0..<Self.opens {
            samples.append(try fixture.open().openSeconds ?? .infinity)
            fixture.selectWorkspace()
        }
        samples.sort()
        let median = samples[samples.count / 2]
        attach("open (s): \(samples), median \(median), events \(fixture.session.lastSeq)")
        recordBudget(BudgetMeasurement(
            id: "timeline-open", measured: median * 1000, threshold: Self.openBudgetSeconds * 1000, unit: "ms",
            samples: samples.map { $0 * 1000 }))
        XCTAssertLessThan(
            median, Self.openBudgetSeconds,
            "median open of \(fixture.session.lastSeq) events took \(median) s; samples \(samples)")
        fixture.quit()
    }

    @MainActor
    func testScrollHitchTimeRatioIsUnderOnePercent() throws {
        // Pica scrolls the timeline itself once it has opened (`ScrollScript`): XCUITest's own scrolling jumps a page
        // per event, and its accessibility queries hold Pica's main thread for seconds, which would count as hitches.
        let fixture = try TimelineFixture(scrollScript: true)
        defer { fixture.remove() }
        _ = try fixture.open()
        let report = try fixture.report { $0.scrolled }
        attach("scroll: \(report.scrollSeconds) s, hitches \(report.hitches) for \(report.hitchSeconds) s, ratio \(report.hitchRatio)")
        recordBudget(BudgetMeasurement(
            id: "timeline-hitch", measured: report.hitchRatio * 100, threshold: Self.hitchRatioBudget * 100, unit: "%"))
        XCTAssertLessThan(
            report.hitchRatio, Self.hitchRatioBudget,
            "hitch time ratio \(report.hitchRatio): \(report.hitches) hitches, \(report.hitchSeconds) s of \(report.scrollSeconds) s")
        fixture.quit()
    }

    @MainActor
    func testStreamingAppendsDoNotMoveTheScrollPositionWhenScrolledUp() throws {
        let fixture = try TimelineFixture()
        defer { fixture.remove() }
        _ = try fixture.open()
        let list = fixture.listCenter()
        for _ in 0..<4 { list.scroll(byDeltaX: 0, deltaY: 600) }
        let anchor = try XCTUnwrap(fixture.visibleRow(), "no timeline row is visible")
        let scrolledUp = try fixture.report { !$0.isAtBottom }

        // The next turn streams a message and its usage below what the user is reading.
        let streamed = try fixture.sendAndWait("more")
        XCTAssertGreaterThan(streamed.contentHeight, scrolledUp.contentHeight, "the streamed message did not grow the timeline")
        XCTAssertEqual(streamed.scrollOffset, scrolledUp.scrollOffset, accuracy: 0.5, "the timeline scrolled while the user was up")
        let after = fixture.app.descendants(matching: .any)[anchor.identifier].frame
        XCTAssertEqual(after.minY, anchor.frame.minY, accuracy: 1, "row \(anchor.identifier) moved from \(anchor.frame) to \(after)")

        // Back at the bottom, the timeline follows the next streamed message.
        for _ in 0..<10 { list.scroll(byDeltaX: 0, deltaY: -2000) }
        _ = try fixture.report { $0.isAtBottom }
        let followed = try fixture.sendAndWait("again") { $0.contentHeight > streamed.contentHeight && $0.isAtBottom }
        XCTAssertTrue(followed.isAtBottom, "the timeline did not follow the streamed message")
        fixture.quit()
    }

    @MainActor
    private func attach(_ text: String) {
        print("TimelineUITests:", text)
        let attachment = XCTAttachment(string: text)
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

/// Pica on the `timeline` scenario, with one session whose first turn has written about 10,000 events.
@MainActor
private final class TimelineFixture {
    let pica: PicaUnderTest
    let app: XCUIApplication
    let workspace: Workspace
    private(set) var session: Session

    init(scrollScript: Bool = false) throws {
        pica = try PicaUnderTest(scenario: "timeline", scrollScript: scrollScript)
        app = pica.launch()
        let path = try pica.makeRepository("atlas")
        (workspace, session) = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            let repo = try await engine.addRepo(at: path, to: workspace)
            let created = try await engine.createSession(in: workspace, writing: repo, prompt: "go")
            return (workspace, try await engine.waitUntilIdle(created.id))
        }
        XCTAssertGreaterThanOrEqual(session.lastSeq, 10_000, "the fixture session is too small")
    }

    var list: XCUIElement {
        app.descendants(matching: .any)["pica.timeline.list"]
    }

    /// The middle of the list, as a point in the window. Finding the list itself means walking an accessibility tree
    /// with a row per timeline row, which takes seconds; the window is found at once.
    func listCenter() -> XCUICoordinate {
        let frame = list.frame
        let window = app.windows.firstMatch
        let origin = window.frame.origin
        return window.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: frame.midX - origin.x, dy: frame.midY - origin.y))
    }

    /// Selects the session in the sidebar and returns the report once its timeline is on screen.
    func open() throws -> TimelineMetricsReport {
        try? FileManager.default.removeItem(atPath: pica.timelineMetricsPath)
        let row = app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the session is not in the sidebar")
        // ⌘1 selects the first session in sidebar order, the only one here.
        app.typeKey("1", modifierFlags: .command)
        let report = try self.report { $0.openSeconds != nil }
        XCTAssertEqual(report.events, session.lastSeq)
        return report
    }

    func selectWorkspace() {
        app.descendants(matching: .any)["pica.sidebar.workspace.\(workspace.id)"].click()
    }

    /// Waits for Pica's report to satisfy `condition`, then a little longer so it settles.
    func report(where condition: @escaping (TimelineMetricsReport) -> Bool) throws -> TimelineMetricsReport {
        let path = pica.timelineMetricsPath
        var latest: TimelineMetricsReport?
        waitUntil("Pica reports its timeline metrics", timeout: 20) {
            latest = try? JSONDecoder().decode(TimelineMetricsReport.self, from: Data(contentsOf: URL(filePath: path)))
            return latest.map(condition) ?? false
        }
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        return try JSONDecoder().decode(TimelineMetricsReport.self, from: Data(contentsOf: URL(filePath: path)))
    }

    /// The first row whose top is inside the list's visible frame.
    func visibleRow() -> (identifier: String, frame: CGRect)? {
        let visible = list.frame
        let rows = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'pica.timeline.row.'"))
            .allElementsBoundByIndex
        for row in rows where visible.contains(CGPoint(x: row.frame.midX, y: row.frame.minY + 1)) {
            return (row.identifier, row.frame)
        }
        return nil
    }

    /// Sends `text`, waits for the turn to end, and then for the timeline to have applied every event of it and to
    /// satisfy `condition`. Returns the report then.
    @discardableResult
    func sendAndWait(
        _ text: String, until condition: @escaping (TimelineMetricsReport) -> Bool = { _ in true }
    ) throws -> TimelineMetricsReport {
        let sessionId = session.id
        session = try pica.withEngine { engine in
            try await engine.send(text, to: sessionId)
            return try await engine.waitUntilIdle(sessionId)
        }
        let lastSeq = session.lastSeq
        return try report { $0.lastSeq >= lastSeq && condition($0) }
    }

    func quit() {
        pica.quit(app)
    }

    func remove() {
        pica.remove()
    }
}

/// The part of Pica's `TimelineMetrics.Report` the tests read.
struct TimelineMetricsReport: Decodable {
    var sessionId: String
    var openSeconds: Double?
    var events: Int
    var lastSeq: Int
    var rows: Int
    var scrollSeconds: Double
    var hitchSeconds: Double
    var hitches: Int
    var scrollOffset: Double
    var contentHeight: Double
    var viewportHeight: Double
    var scrolled: Bool
    var hitchRatio: Double

    /// As `ScrollFollow` decides it.
    var isAtBottom: Bool { scrollOffset + viewportHeight >= contentHeight - 9 }
}
