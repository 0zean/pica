import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-13: the MCP Servers window and the inspector's MCP pane. The engine is `fake-picad` with the `mcp`
/// scenario, which sends the GitHub preset's endpoint to a stub MCP server asking for `token` (no network). Pica keeps
/// secrets in memory under UI tests (`PICA_SECRETS=memory`).
final class McpUITests: XCTestCase {
    /// `fakePicadMcpToken` in `fake-picad.ts`.
    private static let token = "pica-ui-test-token"

    @MainActor
    func testAddingAPresetShowsItHealthyAgainstAStubServer() throws {
        let pica = try PicaUnderTest(scenario: "mcp")
        defer { pica.remove() }
        let app = pica.launch()
        let window = openMcpServers(app)
        addGitHubPreset(app, in: window)
        let health = window.descendants(matching: .any)["pica.mcp.health.github"]
        waitUntil("the GitHub server is healthy", timeout: 30) { health.exists && health.label == "Healthy" }
        let tokens = window.descendants(matching: .any)["pica.mcp.tokens.github"]
        XCTAssertTrue(
            (tokens.label + ((tokens.value as? String) ?? "")).contains("tokens"),
            "the token-cost column shows no estimate: \(tokens.label)")
        pica.quit(app)
    }

    @MainActor
    func testASavedSecretIsNeverRenderedBackIntoAField() throws {
        let pica = try PicaUnderTest(scenario: "mcp")
        defer { pica.remove() }
        let app = pica.launch()
        let window = openMcpServers(app)
        addGitHubPreset(app, in: window)
        let health = window.descendants(matching: .any)["pica.mcp.health.github"]
        waitUntil("the GitHub server is healthy", timeout: 30) { health.exists && health.label == "Healthy" }

        window.buttons["pica.mcp.edit.github"].click()
        let editor = app.descendants(matching: .any)["pica.mcp.editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5), "the editor did not open")
        let field = editor.secureTextFields["pica.mcp.editor.secret.Authorization"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the Authorization header is not shown as a secret")
        XCTAssertTrue(editor.descendants(matching: .any)["pica.mcp.editor.saved.Authorization"].exists, "the secret is not shown as saved")
        let shown = (field.value as? String) ?? ""
        XCTAssertFalse(shown.contains("•"), "the secret field is filled: \(shown)")
        XCTAssertFalse(shown.contains(Self.token))
        let leaks = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@ OR title CONTAINS %@", Self.token, Self.token, Self.token))
        XCTAssertEqual(leaks.count, 0, "the saved token appears in the window")

        // Saving without typing keeps the saved secret: the server stays healthy.
        editor.buttons["pica.mcp.editor.save"].click()
        waitUntil("the editor closes", timeout: 5) { !editor.exists }
        XCTAssertEqual(health.label, "Healthy")
        pica.quit(app)
    }

    @MainActor
    func testChangingServersOnARunningSessionShowsTheCacheWarningFirst() throws {
        let pica = try PicaUnderTest(scenario: "mcp")
        defer { pica.remove() }
        let app = pica.launch()
        let repoPath = try pica.makeRepository("atlas")
        let session = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Acme")
            let repo = try await engine.addRepo(at: repoPath, to: workspace)
            let server = try await engine.request(
                Methods.McpRenderPreset.self, McpRenderPresetParams(presetId: "github", parameters: ["auth": "copilot"])
            ).server
            _ = try await engine.request(Methods.McpAdd.self, McpAddParams(server: server))
            let created = try await engine.createSession(in: workspace, writing: repo)
            return try await engine.waitUntilIdle(created.id)
        }
        XCTAssertTrue(app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"].waitForExistence(timeout: 10))
        app.typeKey("1", modifierFlags: .command)
        app.buttons["pica.toolbar.inspector"].click()
        pica.showInspectorPane("MCP", in: app)
        let toggle = app.checkBoxes["pica.mcp.session.toggle.github"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "the session's MCP pane does not list the GitHub server")
        toggle.click()

        let warning = app.staticTexts["Reset this session's prompt cache?"]
        XCTAssertTrue(warning.waitForExistence(timeout: 5), "no cache-invalidation warning appeared")
        XCTAssertEqual(try attachedServers(pica, session.id), [], "the server was attached before the warning was accepted")

        app.buttons["Change Servers"].click()
        var attached: [Id] = []
        waitUntil("the server is attached", timeout: 10) {
            attached = (try? self.attachedServers(pica, session.id)) ?? []
            return attached == ["github"]
        }
        XCTAssertEqual(toggle.value as? Int, 1)
        // The chosen pane is remembered across launches; leave Files chosen for the other tests.
        pica.showInspectorPane("Files", in: app)
        pica.quit(app)
    }

    @MainActor
    private func openMcpServers(_ app: XCUIApplication) -> XCUIElement {
        app.typeKey("m", modifierFlags: [.command, .shift])
        let window = app.windows.containing(.any, identifier: "pica.mcp").firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10), "⇧⌘M did not open the MCP Servers window")
        return window
    }

    @MainActor
    private func addGitHubPreset(_ app: XCUIApplication, in window: XCUIElement) {
        let add = window.descendants(matching: .any)["pica.mcp.add"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), "no Add Server menu")
        add.click()
        let item = app.menuItems["GitHub"]
        XCTAssertTrue(
            item.waitForExistence(timeout: 5),
            "the GitHub preset is not offered: \(app.menuItems.allElementsBoundByIndex.map(\.title)) \(window.debugDescription)")
        item.click()
        let sheet = app.descendants(matching: .any)["pica.mcp.preset"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 5), "the preset form did not open")
        let auth = sheet.popUpButtons["pica.mcp.preset.param.auth"]
        XCTAssertTrue(auth.waitForExistence(timeout: 5), "the preset has no Sign-in choice")
        auth.click()
        app.menuItems["pat"].click()
        let secret = sheet.secureTextFields["pica.mcp.preset.secret.patSecretRef"]
        XCTAssertTrue(secret.waitForExistence(timeout: 5), "choosing pat shows no token field")
        secret.click()
        secret.typeText(Self.token)
        let addButton = app.buttons["pica.mcp.preset.add"]
        XCTAssertTrue(addButton.waitForExistence(timeout: 5), "no Add Server button: \(app.debugDescription)")
        addButton.click()
        waitUntil("the preset form closes", timeout: 10) { !sheet.exists }
        XCTAssertTrue(window.descendants(matching: .any)["pica.mcp.row.github"].waitForExistence(timeout: 10), "the server is not listed")
    }

    @MainActor
    private func attachedServers(_ pica: PicaUnderTest, _ sessionId: Id) throws -> [Id] {
        try pica.withEngine { engine in
            try await engine.request(Methods.McpAttachments.self, McpAttachmentsParams(sessionId: sessionId)).attachments.map(\.serverId)
        }
    }
}
