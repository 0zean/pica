import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md X-02: the Agents & Skills window (docs/agents.md) against `fake-picad`, whose composition is the production
/// one: `customization.create` validates an agent with C-02's validator before writing it, and the engine's agent
/// loader reads the user's agents folder when it starts.
final class CustomizationUITests: XCTestCase {
    private static let agentsFolder = "Library/Application Support/Pica/agents"

    @MainActor
    func testAnAgentCreatedInTheUIIsWrittenAsAFileTheLoaderAccepts() throws {
        let pica = try PicaUnderTest()
        defer { pica.remove() }
        var app = pica.launch()
        let window = openAgentsAndSkills(app)

        window.buttons["pica.customization.new"].click()
        let sheet = app.descendants(matching: .any)["pica.customization.newSheet"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 5), "New Agent did not open its sheet")
        type("changelog-checker", into: sheet.textFields["pica.customization.new.name"])
        type("Checks changelog entries: one per merged pull request", into: sheet.textFields["pica.customization.new.description"])
        type("You check that every merged pull request has a changelog entry.", into: sheet.textViews["pica.customization.new.body"])
        sheet.buttons["pica.customization.new.create"].click()
        waitUntil("the sheet closes", timeout: 10) { !sheet.exists }

        let row = window.descendants(matching: .any)["pica.customization.row.user.changelog-checker"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the new agent is not listed")
        XCTAssertTrue(row.label.contains("You") && row.label.contains("Active"), row.label)
        let file = pica.home.appending(path: "\(Self.agentsFolder)/changelog-checker.md")
        let text = try String(contentsOf: file, encoding: .utf8)
        XCTAssertTrue(text.hasPrefix("---\ndescription: \"Checks changelog entries: one per merged pull request\"\n"), text)

        // The engine refuses to start on an agent its loader rejects; after a relaunch it serves this one.
        pica.quit(app)
        app = pica.launch()
        let agents = try pica.withEngine { engine in
            try await engine.request(Methods.AgentsList.self, AgentsListParams()).agents
        }
        let agent = try XCTUnwrap(agents.first { $0.name == "changelog-checker" }, "\(agents.map(\.name))")
        XCTAssertEqual(agent.sourceLayer, .user)
        XCTAssertEqual(agent.tier, .worker)
        XCTAssertEqual(agent.tools, ["glob", "grep", "view"])
        pica.quit(app)
    }

    @MainActor
    func testTheWindowShowsEachItemsLayerAndWhichOneWins() throws {
        let pica = try PicaUnderTest()
        defer { pica.remove() }
        let agent = { (description: String) in "---\ndescription: \(description)\ntools: [view, grep]\n---\n\nRead.\n" }
        let userAgent = pica.home.appending(path: "\(Self.agentsFolder)/bulk-reader.md")
        try FileManager.default.createDirectory(at: userAgent.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(agent("My reader").utf8).write(to: userAgent)
        let repoPath = try pica.makeRepository("atlas", files: [".pica/agents/bulk-reader.md": agent("Atlas reader")])
        let app = pica.launch()
        let (workspace, repo) = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Acme")
            return (workspace, try await engine.addRepo(at: repoPath, to: workspace))
        }
        XCTAssertTrue(
            app.descendants(matching: .any)["pica.sidebar.workspace.\(workspace.id)"].waitForExistence(timeout: 10),
            "the workspace is not in the sidebar")
        let window = openAgentsAndSkills(app)

        let builtin = window.descendants(matching: .any)["pica.customization.row.builtin.bulk-reader"]
        let user = window.descendants(matching: .any)["pica.customization.row.user.bulk-reader"]
        XCTAssertTrue(user.waitForExistence(timeout: 10), "the user's agent is not listed")
        XCTAssertTrue(user.label.contains("Wins"), user.label)
        XCTAssertTrue(builtin.label.contains("Built-in") && builtin.label.contains("Overridden by You"), builtin.label)

        let scope = window.popUpButtons["pica.customization.scope"]
        XCTAssertTrue(scope.waitForExistence(timeout: 5))
        waitUntil("the workspace's repo is offered", timeout: 10) {
            scope.click()
            let found = app.menuItems["Acme › atlas"].waitForExistence(timeout: 2)
            if !found { app.typeKey(.escape, modifierFlags: []) }
            return found
        }
        app.menuItems["Acme › atlas"].click()

        let repoRow = window.descendants(matching: .any)["pica.customization.row.repo:\(repo.id):pica-agents.bulk-reader"]
        XCTAssertTrue(repoRow.waitForExistence(timeout: 10), "the repo's agent is not listed")
        XCTAssertTrue(repoRow.label.contains("atlas · .pica/agents") && repoRow.label.contains("Wins"), repoRow.label)
        waitUntil("the user's agent is shown overridden", timeout: 5) { user.label.contains("Overridden by atlas · .pica/agents") }
        XCTAssertTrue(builtin.label.contains("Overridden by atlas · .pica/agents"), builtin.label)
        pica.quit(app)
    }

    @MainActor
    func testAManagedLockLeavesAgentsReadOnlyAndNamesThePolicy() throws {
        let pica = try PicaUnderTest(managedPolicy: #"{ "id": "acme", "customization": { "locked": ["agent"] } }"#)
        defer { pica.remove() }
        let userAgent = pica.home.appending(path: "\(Self.agentsFolder)/helper.md")
        try FileManager.default.createDirectory(at: userAgent.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("---\ndescription: Helps\ntools: [view]\n---\n\nHelp.\n".utf8).write(to: userAgent)
        let app = pica.launch()
        let window = openAgentsAndSkills(app)

        let row = window.descendants(matching: .any)["pica.customization.row.user.helper"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the user's agent is not listed")
        row.click()
        let lock = window.descendants(matching: .any)["pica.customization.lock"]
        XCTAssertTrue(lock.waitForExistence(timeout: 5), "no lock line")
        XCTAssertTrue(lock.label.contains("acme"), lock.label)
        XCTAssertFalse(window.buttons["pica.customization.new"].isEnabled, "New Agent is enabled under the lock")
        XCTAssertFalse(window.buttons["pica.customization.delete"].isEnabled, "Delete is enabled under the lock")
        pica.quit(app)
    }

    @MainActor
    private func openAgentsAndSkills(_ app: XCUIApplication) -> XCUIElement {
        app.typeKey("a", modifierFlags: [.command, .shift])
        let window = app.windows.containing(.any, identifier: "pica.customization").firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10), "⇧⌘A did not open the Agents & Skills window")
        return window
    }

    @MainActor
    private func type(_ text: String, into field: XCUIElement) {
        XCTAssertTrue(field.waitForExistence(timeout: 5), "no field \(field)")
        field.click()
        field.typeText(text)
    }
}
