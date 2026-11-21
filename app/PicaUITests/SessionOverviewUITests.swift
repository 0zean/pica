import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-16: the Session Overview's board puts sessions awaiting approval first, shows each fan-out's aggregate,
/// and costs no more than the idle CPU budget (PLAN.md §9) while nothing changes. Sessions play the `overview`
/// scenario of `fake-picad-scenarios.ts`: one message ends idle, a second waits for approval.
final class SessionOverviewUITests: XCTestCase {
    @MainActor
    func testSessionsAwaitingApprovalAppearFirst() throws {
        let pica = try PicaUnderTest(scenario: "overview")
        defer { pica.remove() }
        let app = pica.launch()
        let paths = try ["atlas", "beacon", "comet"].map { try pica.makeRepository($0) }
        // The waiting sessions are made first, so they are the oldest: the board ranks them by state, not by recency.
        let made = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            var repos: [Repo] = []
            for path in paths { repos.append(try await engine.addRepo(at: path, to: workspace)) }
            let waiting = try await Self.sessions(engine, 2, in: workspace, repo: repos[0], messages: 2)
            let idle = try await Self.sessions(engine, 3, in: workspace, repo: repos[1], messages: 1)
            let fanOut = try await engine.request(
                Methods.FanoutStart.self,
                FanoutStartParams(workspaceId: workspace.id, repoIds: repos.map(\.id), prompt: "Check the README")
            ).fanOut
            return (waiting: waiting, idle: idle, fanOut: fanOut.id)
        }

        app.typeKey("o", modifierFlags: [.command, .shift])
        let board = app.descendants(matching: .any)["pica.overview.board"]
        XCTAssertTrue(board.waitForExistence(timeout: 10), "the Session Overview did not open")
        let cards = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'pica.overview.session.'"))
        // Two waiting, three idle, and the fan-out's three sessions once it has run.
        waitUntil("every session is on the board", timeout: 30) { cards.count == 8 }
        // XCUITest lists elements in no particular order, so the board's order is read from where the cards are drawn:
        // top to bottom, then left to right.
        let order = Self.readingOrder(cards.allElementsBoundByIndex)
        XCTAssertEqual(Set(order.prefix(2)), Set(made.waiting), "the sessions awaiting approval are not first: \(order)")
        XCTAssertEqual(Array(order.prefix(2)), made.waiting, "the longest waiting is not first")
        let queue = app.descendants(matching: .any)["pica.overview.queue"]
        for id in made.waiting {
            XCTAssertTrue(queue.descendants(matching: .any)["pica.overview.session.\(id)"].exists, "\(id) is not in the queue")
        }
        for id in made.idle {
            XCTAssertFalse(queue.descendants(matching: .any)["pica.overview.session.\(id)"].exists, "\(id) is in the queue")
        }

        // The fan-out's aggregate reports each repo.
        Self.showTab("Fan-outs", in: app)
        let fanOut = app.descendants(matching: .any)["pica.overview.fanout.\(made.fanOut)"]
        XCTAssertTrue(fanOut.waitForExistence(timeout: 10), "the fan-out is not shown")
        let counts = fanOut.descendants(matching: .any)["pica.overview.fanout.counts"]
        waitUntil("the fan-out reports three successes", timeout: 30) {
            (counts.value as? String ?? counts.label).contains("3 of 3 done · 3 succeeded")
        }
        XCTAssertEqual(
            fanOut.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'pica.overview.fanout.run.'")).count, 3)

        // Opening a waiting session from the queue selects it in the main window.
        Self.showTab("Board", in: app)
        app.descendants(matching: .any)["pica.overview.session.\(made.waiting[0])"].click()
        let approval = app.buttons["pica.approval.allow_once"].firstMatch
        XCTAssertTrue(approval.waitForExistence(timeout: 10), "the waiting session did not open in the main window")
        pica.quit(app)
    }

    @MainActor
    func testTwentyIdleSessionsKeepTheBoardUnderTheIdleCPUBudget() throws {
        let pica = try PicaUnderTest(scenario: "overview")
        defer { pica.remove() }
        let app = pica.launch()
        let paths = try ["atlas", "beacon", "comet", "delta"].map { try pica.makeRepository($0) }
        try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            for path in paths {
                let repo = try await engine.addRepo(at: path, to: workspace)
                // One waiting session per repo, four idle ones: twenty live sessions, four in the queue.
                _ = try await Self.sessions(engine, 1, in: workspace, repo: repo, messages: 2)
                _ = try await Self.sessions(engine, 4, in: workspace, repo: repo, messages: 1)
            }
        }
        try? FileManager.default.removeItem(atPath: pica.overviewMetricsPath)
        app.typeKey("o", modifierFlags: [.command, .shift])
        let cards = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'pica.overview.session.'"))
        waitUntil("every session is on the board", timeout: 30) { cards.count == 20 }

        // Pica measures itself once the board has settled; nothing here touches the app meanwhile, since accessibility
        // queries cost it CPU.
        let path = pica.overviewMetricsPath
        var report: OverviewReport?
        waitUntil("Pica reports the board's CPU use", timeout: 60) {
            report = try? JSONDecoder().decode(OverviewReport.self, from: Data(contentsOf: URL(filePath: path)))
            return report != nil
        }
        let measured = try XCTUnwrap(report)
        print("A-16 idle board: \(measured)")
        XCTAssertEqual(measured.sessions, 20)
        XCTAssertEqual(measured.queued, 4)
        XCTAssertEqual(measured.boardChanges, 0, "the board changed while nothing did")
        XCTAssertGreaterThanOrEqual(measured.wallSeconds, 9.9)
        XCTAssertLessThan(measured.cpuFraction, 0.01, "the app used \(measured.cpuFraction * 100)% of a core")
        pica.quit(app)
    }

    /// The cards' session ids, top to bottom and then left to right.
    @MainActor
    private static func readingOrder(_ cards: [XCUIElement]) -> [Id] {
        let placed: [(id: Id, frame: CGRect)] = cards.map { card in
            (String(card.identifier.dropFirst("pica.overview.session.".count)), card.frame)
        }
        let sorted = placed.sorted { left, right in
            if left.frame.minY != right.frame.minY { return left.frame.minY < right.frame.minY }
            return left.frame.minX < right.frame.minX
        }
        return sorted.map(\.id)
    }

    @MainActor
    private static func showTab(_ title: String, in app: XCUIApplication) {
        let tabs = app.descendants(matching: .any)["pica.overview.tab"]
        (tabs.radioButtons[title].exists ? tabs.radioButtons[title] : tabs.buttons[title]).click()
    }

    /// Makes `count` sessions and plays `messages` turns of the scenario in each: one ends idle, two waits for approval.
    private static func sessions(
        _ engine: EngineClient, _ count: Int, in workspace: Workspace, repo: Repo, messages: Int
    ) async throws -> [Id] {
        var ids: [Id] = []
        for _ in 0..<count {
            let session = try await engine.createSession(in: workspace, writing: repo)
            try await engine.send("look", to: session.id)
            _ = try await engine.waitUntilIdle(session.id)
            if messages > 1 {
                try await engine.send("test", to: session.id)
                try await engine.waitUntil(session.id, is: .awaitingApproval)
            }
            ids.append(session.id)
        }
        return ids
    }
}

/// `OverviewMetrics.Report` as Pica writes it.
private struct OverviewReport: Decodable, CustomStringConvertible {
    var sessions: Int
    var queued: Int
    var cpuSeconds: Double
    var wallSeconds: Double
    var boardChanges: Int
    var cpuFraction: Double

    var description: String {
        String(
            format: "%d sessions, %d queued, %.3f s CPU over %.1f s (%.2f%%), %d board changes", sessions, queued,
            cpuSeconds, wallSeconds, cpuFraction * 100, boardChanges)
    }
}

extension EngineClient {
    func waitUntil(_ sessionId: Id, is state: SessionState, timeout: Duration = .seconds(30)) async throws {
        let deadline = ContinuousClock.now + timeout
        while true {
            let session = try await request(Methods.SessionGet.self, BySession(sessionId: sessionId)).session
            if session.state == state { return }
            guard ContinuousClock.now < deadline else { throw WaitError.timedOut(session.state) }
            try await Task.sleep(for: .milliseconds(100))
        }
    }
}
