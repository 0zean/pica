import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-07: approval cards in the timeline resolve each choice, and "Always allow" writes a permission rule
/// that answers the next identical request. The session plays the `approvals` scenario of `fake-picad-scenarios.ts`:
/// four turns run `npm test` and a fifth `npm run lint`, and the runtime asks before each.
final class ApprovalsUITests: XCTestCase {
    @MainActor
    func testEachChoiceResolvesAndAlwaysAllowSuppressesTheNextIdenticalRequest() throws {
        let pica = try PicaUnderTest(scenario: "approvals")
        defer { pica.remove() }
        let app = pica.launch()
        let path = try pica.makeRepository("atlas")
        let session = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            let repo = try await engine.addRepo(at: path, to: workspace)
            return try await engine.createSession(in: workspace, writing: repo)
        }
        XCTAssertTrue(
            app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"].waitForExistence(timeout: 10),
            "the session is not in the sidebar")
        app.typeKey("1", modifierFlags: .command)

        // Allow once: the call runs, and nothing is saved.
        let once = try turn(pica, app, session.id, choosing: "allow_once", shows: "Allowed once")
        XCTAssertEqual(once.choices, ["allow_once"])
        XCTAssertEqual(once.toolOutcomes, ["tool.completed"])
        XCTAssertNil(try permissionRules(pica), "allow once wrote a rule")

        // Deny: the call fails, and nothing is saved.
        let denied = try turn(pica, app, session.id, choosing: "deny", shows: "Denied")
        XCTAssertEqual(denied.choices, ["deny"])
        XCTAssertEqual(denied.toolOutcomes, ["tool.failed"])
        XCTAssertNil(try permissionRules(pica), "deny wrote a rule")

        // Always allow: the call runs and the rule is in the user's config.
        let always = try turn(pica, app, session.id, choosing: "allow_always", shows: "Always allowed")
        XCTAssertEqual(always.choices, ["allow_always"])
        XCTAssertEqual(always.toolOutcomes, ["tool.completed"])
        XCTAssertEqual(try permissionRules(pica), [["tool": "bash", "match": "npm test", "permission": "allow"]])

        // The identical request is answered by the rule: no card, and the call runs.
        let suppressed = try turn(pica, app, session.id, choosing: nil, shows: nil)
        XCTAssertEqual(suppressed.requests, 0, "the identical request asked again")
        XCTAssertEqual(suppressed.toolOutcomes, ["tool.completed"])
        XCTAssertEqual(pendingChoices(app).count, 0, "a card is waiting after the rule answered")

        // Another command is another request: it asks again.
        let other = try turn(pica, app, session.id, choosing: "deny", shows: "Denied")
        XCTAssertEqual(other.requests, 1)
        XCTAssertEqual(other.toolOutcomes, ["tool.failed"])
        pica.quit(app)
    }

    /// Sends a message; when `choice` is set, waits for the card, clicks the choice and waits for the card to show
    /// `shows`. Returns what the engine recorded for the turn.
    @MainActor
    private func turn(
        _ pica: PicaUnderTest, _ app: XCUIApplication, _ sessionId: Id, choosing choice: String?, shows: String?
    ) throws -> TurnRecord {
        let before = try pica.withEngine { engine in
            try await engine.request(Methods.SessionGet.self, BySession(sessionId: sessionId)).session.lastSeq
        }
        try pica.withEngine { engine in try await engine.send("go", to: sessionId) }
        if let choice, let shows {
            let button = app.buttons["pica.approval.\(choice)"].firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 20), "no card offers \(choice)")
            // A card that has just arrived may still sit below the visible part of the timeline.
            let list = app.descendants(matching: .any)["pica.timeline.list"]
            waitUntil("the choice can be clicked", timeout: 10) {
                if button.isHittable { return button.isEnabled }
                list.scroll(byDeltaX: 0, deltaY: -2000)
                return false
            }
            button.click()
            // The newest card is the last one in the list. Older ones may have left the lazily built rows, so count
            // nothing. A combined element's text is in its value.
            let summaries = app.descendants(matching: .any).matching(identifier: "pica.approval.summary")
            waitUntil("the newest card shows “\(shows)”", timeout: 20) {
                guard let newest = summaries.allElementsBoundByIndex.last else { return false }
                return newest.label.contains(shows) || (newest.value as? String)?.contains(shows) == true
            }
            waitUntil("no card offers a choice", timeout: 10) { self.pendingChoices(app).isEmpty }
        }
        return try pica.withEngine { engine in
            let idle = try await engine.waitUntilIdle(sessionId)
            return try await TurnRecord(engine, sessionId, after: before, through: idle.lastSeq)
        }
    }

    @MainActor
    private func pendingChoices(_ app: XCUIApplication) -> [XCUIElement] {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pica.approval.'")).allElementsBoundByIndex
    }

    /// `permissions.tools` in the user's `config.jsonc`, which the engine writes without comments.
    @MainActor
    private func permissionRules(_ pica: PicaUnderTest) throws -> [[String: String]]? {
        let file = pica.home.appending(path: "Library/Application Support/Pica/config.jsonc")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let config = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
        return (config?["permissions"] as? [String: Any])?["tools"] as? [[String: String]]
    }
}

/// What the engine recorded for one turn, read from the session's events.
private struct TurnRecord: Sendable {
    var requests = 0
    var choices: [String] = []
    var toolOutcomes: [String] = []

    init(_ engine: EngineClient, _ sessionId: Id, after: Seq, through last: Seq) async throws {
        guard last > after else { return }
        let encoder = JSONEncoder()
        for try await event in await engine.events(sessionId: sessionId, afterSeq: after) {
            let object = try JSONSerialization.jsonObject(with: encoder.encode(event)) as? [String: Any] ?? [:]
            let type = object["type"] as? String ?? ""
            let payload = object["payload"] as? [String: Any] ?? [:]
            switch type {
            case "approval.requested": requests += 1
            case "approval.resolved": choices.append(payload["choice"] as? String ?? "")
            case "tool.completed", "tool.failed": toolOutcomes.append(type)
            default: break
            }
            if (object["seq"] as? Int ?? 0) >= last { break }
        }
    }
}
