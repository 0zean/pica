import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-06: `@` opens completions and Return inserts; ⌘↩ sends; sending while a turn runs queues. Sessions play
/// the `composer` scenario of `fake-picad-scenarios.ts`, whose first turn runs until it is stopped.
final class ComposerUITests: XCTestCase {
    @MainActor
    func testAtOpensCompletionsAndReturnInserts() throws {
        let fixture = try ComposerFixture()
        defer { fixture.remove() }
        let input = fixture.focusInput()
        input.typeText("look at @at")
        let repo = fixture.app.descendants(matching: .any)["pica.composer.completion.repo.atlas"]
        XCTAssertTrue(repo.waitForExistence(timeout: 5), "typing @at did not offer the atlas repo")
        XCTAssertTrue(fixture.app.descendants(matching: .any)["pica.composer.completions"].exists)

        input.typeKey(.return, modifierFlags: [])
        XCTAssertEqual(input.value as? String, "look at @atlas ")
        waitUntil("the completions close", timeout: 5) { !repo.exists }

        // Agents are offered too, and Return inserts the selected one.
        input.typeText("with @bulk")
        let agent = fixture.app.descendants(matching: .any)["pica.composer.completion.agent.bulk-reader"]
        XCTAssertTrue(agent.waitForExistence(timeout: 5), "typing @bulk did not offer the bulk-reader agent")
        input.typeKey(.return, modifierFlags: [])
        XCTAssertEqual(input.value as? String, "look at @atlas with @bulk-reader ")
        fixture.quit()
    }

    /// A-09 serves `files.quickOpen` and `files.list`, so files and skills complete too.
    @MainActor
    func testFilesAndSkillsComplete() throws {
        let fixture = try ComposerFixture(files: [
            "src/main.swift": "print(1)\n",
            "docs/domain.md": "# Domain\n",
            ".github/skills/review/SKILL.md": "# Review\n",
        ])
        defer { fixture.remove() }
        let input = fixture.focusInput()
        input.typeText("open @mainsw")
        let file = fixture.app.descendants(matching: .any)["pica.composer.completion.file.atlas:src/main.swift"]
        XCTAssertTrue(file.waitForExistence(timeout: 5), "typing @mainsw did not offer atlas:src/main.swift")
        input.typeKey(.return, modifierFlags: [])
        XCTAssertEqual(input.value as? String, "open @atlas:src/main.swift ")

        // A skill starts a line; clear the text first.
        input.typeKey("a", modifierFlags: .command)
        input.typeKey(.delete, modifierFlags: [])
        input.typeText("/rev")
        let skill = fixture.app.descendants(matching: .any)["pica.composer.completion.skill.review"]
        XCTAssertTrue(skill.waitForExistence(timeout: 5), "typing /rev did not offer the review skill")
        fixture.quit()
    }

    @MainActor
    func testCommandReturnSends() throws {
        let fixture = try ComposerFixture()
        defer { fixture.remove() }
        let input = fixture.focusInput()
        input.typeText("hello")
        input.typeKey(.return, modifierFlags: .command)
        waitUntil("the input is cleared", timeout: 5) { (input.value as? String) == "" }

        let messages = try fixture.userMessages(count: 1)
        XCTAssertEqual(messages.map(\.text), ["hello"])
        XCTAssertEqual(messages.map(\.mode), [.send])
        fixture.quit()
    }

    @MainActor
    func testSendingWhileRunningQueues() throws {
        let fixture = try ComposerFixture()
        defer { fixture.remove() }
        let input = fixture.focusInput()
        input.typeText("start")
        input.typeKey(.return, modifierFlags: .command)
        // The first turn runs until it is stopped; the send button becomes Queue.
        let send = fixture.app.buttons["pica.composer.send"]
        waitUntil("the session is running", timeout: 10) { send.label == "Queue" }
        XCTAssertTrue(fixture.app.buttons["pica.composer.steer"].exists)

        input.typeText("next")
        input.typeKey(.return, modifierFlags: .command)
        waitUntil("the input is cleared", timeout: 5) { (input.value as? String) == "" }
        let status = fixture.app.descendants(matching: .any)["pica.composer.status"]
        XCTAssertTrue(status.waitForExistence(timeout: 5), "no status after queueing")

        let messages = try fixture.userMessages(count: 2)
        XCTAssertEqual(messages.map(\.text), ["start", "next"])
        XCTAssertEqual(messages.map(\.mode), [.send, .queue])
        fixture.stopTurn()
        fixture.quit()
    }
}

/// PLAN.md §9: keystroke to glyph under 16 ms with a 10,000-event session open. The session plays the `timeline`
/// scenario. XCUITest types 120 characters into the composer, through the system's event path as a keyboard's keys
/// arrive, and Pica measures each keystroke itself (`ComposerMetrics`, docs/composer.md).
final class ComposerLatencyUITests: XCTestCase {
    private static let budgetMs = 16.0
    private static let keystrokes = 120

    @MainActor
    func testKeystrokeToGlyphIsUnder16MillisecondsWithATenThousandEventSessionOpen() throws {
        let fixture = try ComposerFixture(scenario: "timeline", prompt: "go")
        defer { fixture.remove() }
        XCTAssertGreaterThanOrEqual(fixture.session.lastSeq, 10_000, "the fixture session is too small")
        fixture.waitForTimeline()
        let input = fixture.focusInput()
        let sentence = String(String(repeating: "the quick brown fox jumps over the lazy dog ", count: 3).prefix(Self.keystrokes))
        input.typeText(sentence)
        let report = try fixture.composerReport { $0.keystrokes >= Self.keystrokes }
        XCTAssertEqual(report.textLength, Self.keystrokes, "not every character reached the composer")
        XCTAssertEqual(report.keystrokes, Self.keystrokes, "not every keystroke was measured")

        let glyph = Percentiles(report.glyphMs)
        let summary = "glyph ms \(glyph); commit ms \(Percentiles(report.commitMs)); queue ms \(Percentiles(report.queueMs)); "
            + "handle ms \(Percentiles(report.handleMs)); events \(fixture.session.lastSeq)"
        print("ComposerLatencyUITests:", summary)
        let attachment = XCTAttachment(string: summary)
        attachment.lifetime = .keepAlways
        add(attachment)
        recordBudget(BudgetMeasurement(id: "composer-glyph", measured: glyph.p95, threshold: Self.budgetMs, unit: "ms"))
        XCTAssertLessThan(glyph.p95, Self.budgetMs, summary)
        fixture.quit()
    }
}

struct Percentiles: CustomStringConvertible {
    let median: Double
    let p95: Double
    let max: Double

    init(_ samples: [Double]) {
        let sorted = samples.sorted()
        func at(_ fraction: Double) -> Double {
            sorted.isEmpty ? .infinity : sorted[Swift.min(sorted.count - 1, Int((Double(sorted.count) * fraction).rounded(.up)) - 1)]
        }
        median = at(0.5)
        p95 = at(0.95)
        max = sorted.last ?? .infinity
    }

    var description: String {
        String(format: "median %.1f, p95 %.1f, max %.1f", median, p95, max)
    }
}

/// Pica with one session in a workspace with the `atlas` repo, selected so its composer is on screen.
@MainActor
private final class ComposerFixture {
    let pica: PicaUnderTest
    let app: XCUIApplication
    let session: Session

    init(scenario: String = "composer", prompt: String? = nil, files: [String: String] = [:]) throws {
        pica = try PicaUnderTest(scenario: scenario)
        app = pica.launch()
        let path = try pica.makeRepository("atlas", files: files)
        session = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            let repo = try await engine.addRepo(at: path, to: workspace)
            let created = try await engine.createSession(in: workspace, writing: repo, prompt: prompt)
            return try await engine.waitUntilIdle(created.id)
        }
        let row = app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the session is not in the sidebar")
        // ⌘1 selects the first session in sidebar order, the only one here.
        app.typeKey("1", modifierFlags: .command)
    }

    /// Clicks into the composer's input and returns it.
    func focusInput() -> XCUIElement {
        let input = app.textViews["pica.composer.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10), "the composer is not on screen")
        input.click()
        return input
    }

    /// Waits until the timeline has opened with the whole history applied.
    func waitForTimeline() {
        let path = pica.timelineMetricsPath
        waitUntil("the timeline has opened", timeout: 20) {
            guard let data = try? Data(contentsOf: URL(filePath: path)),
                  let report = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return false }
            return report["openSeconds"] != nil
        }
    }

    func composerReport(where condition: @escaping (ComposerMetricsReport) -> Bool) throws -> ComposerMetricsReport {
        let path = pica.composerMetricsPath
        var latest: ComposerMetricsReport?
        waitUntil("Pica reports its composer metrics", timeout: 60) {
            latest = try? JSONDecoder().decode(ComposerMetricsReport.self, from: Data(contentsOf: URL(filePath: path)))
            return latest.map(condition) ?? false
        }
        return try XCTUnwrap(latest)
    }

    /// The session's first `count` user messages, as the engine recorded them.
    func userMessages(count: Int) throws -> [UserMessagePayload] {
        let sessionId = session.id
        return try pica.withEngine { engine in
            var messages: [UserMessagePayload] = []
            let deadline = ContinuousClock.now + .seconds(10)
            while messages.count < count, ContinuousClock.now < deadline {
                let lastSeq = try await engine.request(Methods.SessionGet.self, BySession(sessionId: sessionId)).session.lastSeq
                messages = []
                guard lastSeq > 0 else {
                    try await Task.sleep(for: .milliseconds(100))
                    continue
                }
                // Events replay from seq 1 without gaps, so the history is done after `lastSeq` of them.
                var replayed = 0
                for try await event in await engine.events(sessionId: sessionId, afterSeq: 0) {
                    if case .userMessage(let message) = event { messages.append(message.payload) }
                    replayed += 1
                    if replayed >= lastSeq { break }
                }
                if messages.count < count { try await Task.sleep(for: .milliseconds(100)) }
            }
            return messages
        }
    }

    func stopTurn() {
        let sessionId = session.id
        _ = try? pica.withEngine { engine in
            try await engine.request(Methods.SessionAbort.self, BySession(sessionId: sessionId))
        }
    }

    func quit() {
        pica.quit(app)
    }

    func remove() {
        pica.remove()
    }
}

/// The part of Pica's `ComposerMetrics.Report` the tests read.
struct ComposerMetricsReport: Decodable {
    var keystrokes: Int
    var textLength: Int
    var glyphMs: [Double]
    var commitMs: [Double]
    var queueMs: [Double]
    var handleMs: [Double]
}
