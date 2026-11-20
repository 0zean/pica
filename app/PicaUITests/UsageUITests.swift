import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-11: a session's usage reaches its chip, the chip's popover and the Usage dashboard, and the savings figure
/// is labeled as an estimate in both. The engine is `fake-picad` with the `usage` scenario.
final class UsageUITests: XCTestCase {
    @MainActor
    func testTheChipAndTheDashboardShowTheSessionsUsage() throws {
        let pica = try PicaUnderTest(scenario: "usage")
        defer { pica.remove() }
        let app = pica.launch()
        let path = try pica.makeRepository("atlas", files: ["README.md": "# Atlas\n"])
        let session = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            let repo = try await engine.addRepo(at: path, to: workspace)
            let session = try await engine.createSession(in: workspace, writing: repo)
            try await engine.send("how many tables are there?", to: session.id)
            return try await engine.waitUntilIdle(session.id)
        }
        XCTAssertTrue(
            app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"].waitForExistence(timeout: 10),
            "the session is not in the sidebar")
        app.typeKey("1", modifierFlags: .command)

        let chip = app.descendants(matching: .any)["pica.timeline.usage"].firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "the timeline has no usage chip")
        waitUntil("the chip shows the turn's usage", timeout: 10) { chip.label.hasPrefix("Context 42% · 104K tokens") }
        if let limit = session.budgetCredits {
            XCTAssertTrue(chip.label.hasSuffix("of \(limit.formatted()) credits"), "the chip omits the budget: \(chip.label)")
        }

        chip.click()
        let byAgent = app.descendants(matching: .any)["pica.usage.session.agent"].firstMatch
        XCTAssertTrue(byAgent.waitForExistence(timeout: 10), "the popover shows no breakdown by agent")
        Self.expectEstimate(app.descendants(matching: .any)["pica.usage.savings"].firstMatch, "the popover")
        app.buttons["pica.usage.openDashboard"].firstMatch.click()

        let byModel = app.descendants(matching: .any)["pica.usage.chart.model"].firstMatch
        XCTAssertTrue(byModel.waitForExistence(timeout: 10), "the dashboard did not open")
        let credits = app.descendants(matching: .any)["pica.usage.total.credits"].firstMatch
        XCTAssertTrue(credits.label.hasPrefix("Credits: "), "the credits total is missing: \(credits.label)")
        Self.expectEstimate(app.descendants(matching: .any)["pica.usage.savings"].firstMatch, "the dashboard")
        pica.quit(app)
    }

    @MainActor
    func testShiftCommandUOpensTheDashboard() throws {
        let pica = try PicaUnderTest(scenario: "usage")
        defer { pica.remove() }
        let app = pica.launch()
        app.typeKey("u", modifierFlags: [.command, .shift])
        XCTAssertTrue(
            app.descendants(matching: .any)["pica.usage.chart.day"].firstMatch.waitForExistence(timeout: 10),
            "⇧⌘U did not open the dashboard")
        Self.expectEstimate(app.descendants(matching: .any)["pica.usage.savings"].firstMatch, "the dashboard")
        pica.quit(app)
    }

    @MainActor
    private static func expectEstimate(_ savings: XCUIElement, _ place: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(savings.waitForExistence(timeout: 10), "\(place) shows no savings figure", file: file, line: line)
        XCTAssertTrue(
            savings.label.hasPrefix("Estimated savings"), "\(place) labels savings “\(savings.label)”", file: file, line: line)
    }
}
