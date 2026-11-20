import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-12: workspace and repo management against `fake-picad`'s stub GitHub server (`fake-github.ts`), which
/// serves acme/platform (atlas, beacon), acme/payments (ledger, billing) and vault-corp/vault, an SSO-protected team.
/// Fix actions are logged to `PicaUnderTest.fixLogPath` instead of opening a browser or writing the pasteboard.
final class WorkspacesUITests: XCTestCase {
    static let ssoUrl = "https://ghe.example.test/orgs/vault-corp/sso?authorization_request=stub"

    @MainActor
    func testImportingTeamsShowsTheirReposAsAvailable() throws {
        let fixture = try WorkspacesFixture(github: "signed-in")
        defer { fixture.remove() }
        // A workspace made from the File menu's shortcut (the registry's New Workspace…).
        try fixture.openWorkspace("Platform")

        fixture.element("pica.workspace.importTeams").click()
        let platform = fixture.app.checkBoxes["pica.teams.row.acme/platform"]
        XCTAssertTrue(platform.waitForExistence(timeout: 10), "the team browser did not list acme/platform")
        // Search narrows the list; ticking keeps a team chosen while the search changes.
        let search = fixture.app.textFields["pica.teams.search"]
        search.click()
        search.typeText("plat")
        waitUntil("the search hides acme/payments", timeout: 5) {
            !fixture.app.checkBoxes["pica.teams.row.acme/payments"].exists
        }
        platform.click()
        search.typeKey("a", modifierFlags: .command)
        search.typeKey(.delete, modifierFlags: [])
        let payments = fixture.app.checkBoxes["pica.teams.row.acme/payments"]
        XCTAssertTrue(payments.waitForExistence(timeout: 5), "clearing the search did not list acme/payments again")
        payments.click()
        XCTAssertEqual(fixture.text("pica.teams.chosen"), "2 chosen")
        fixture.app.buttons["pica.teams.import"].click()

        for repo in ["atlas", "beacon", "ledger", "billing"] {
            let state = fixture.element("pica.workspace.repo.\(repo).state")
            XCTAssertTrue(state.waitForExistence(timeout: 10), "\(repo) is not in the workspace")
            XCTAssertEqual(fixture.text("pica.workspace.repo.\(repo).state"), "Available", "\(repo) is not shown as available")
        }
        XCTAssertFalse(fixture.element("pica.teams").exists, "the team browser stayed open")
        XCTAssertEqual(fixture.text("pica.workspace.syncStatus"), "Synced: 4 repos added.")
        XCTAssertEqual(fixture.text("pica.workspace.source.team.acme/platform.status"), "Synced just now")

        // The engine holds them as available too: listed, not cloned.
        let repos = try fixture.pica.withEngine { engine in
            let workspaces = try await engine.request(Methods.WorkspaceList.self).workspaces
            return try await engine.request(Methods.RepoList.self, RepoListParams(workspaceId: workspaces[0].id)).repos
        }
        XCTAssertEqual(repos.map(\.cloneState), [.available, .available, .available, .available])
        XCTAssertEqual(repos.map(\.localPath), [nil, nil, nil, nil])
        fixture.quit()
    }

    @MainActor
    func testAnSSOErrorShowsItsFixAction() throws {
        let fixture = try WorkspacesFixture(github: "signed-in")
        defer { fixture.remove() }
        try fixture.openWorkspace("Vault")
        fixture.element("pica.workspace.importTeams").click()
        let vault = fixture.app.checkBoxes["pica.teams.row.vault-corp/vault"]
        XCTAssertTrue(vault.waitForExistence(timeout: 10), "the team browser did not list vault-corp/vault")
        vault.click()
        fixture.app.buttons["pica.teams.import"].click()

        let fix = fixture.app.buttons["pica.teams.importProblem.fix"]
        XCTAssertTrue(fix.waitForExistence(timeout: 10), "the SSO error shows no fix")
        XCTAssertEqual(fix.label, "Authorize for single sign-on")
        fix.click()
        fixture.waitForFixLog(["open_url \(Self.ssoUrl)"])

        // The source stays, and the workspace shows the failed sync with the same fix.
        fixture.app.buttons["Cancel"].click()
        let workspaceFix = fixture.app.buttons["pica.workspace.problem.fix"]
        XCTAssertTrue(workspaceFix.waitForExistence(timeout: 5), "the workspace does not show the failed sync's fix")
        XCTAssertEqual(workspaceFix.label, "Authorize for single sign-on")
        XCTAssertTrue(fixture.element("pica.workspace.source.team.vault-corp/vault").exists)
        fixture.quit()
    }

    @MainActor
    func testSignedOutShowsTheSignInFix() throws {
        let fixture = try WorkspacesFixture(github: "signed-out")
        defer { fixture.remove() }
        try fixture.openWorkspace("Platform")
        fixture.element("pica.workspace.importTeams").click()
        let fix = fixture.app.buttons["pica.teams.problem.fix"]
        XCTAssertTrue(fix.waitForExistence(timeout: 10), "signed out shows no fix")
        XCTAssertEqual(fix.label, "Sign in to ghe.example.test")
        fix.click()
        let command = "gh auth login --hostname ghe.example.test --scopes read:org"
        fixture.waitForFixLog(["copy \(command)"])
        XCTAssertTrue(fixture.text("pica.teams.problem.note").contains(command))
        fixture.app.buttons["Cancel"].click()
        waitUntil("the team browser closes", timeout: 5) { !fixture.element("pica.teams.search").exists }
        fixture.quit()
    }

    @MainActor
    func testAddingARepositoryByPathPinsItToTheWorkspace() throws {
        let fixture = try WorkspacesFixture(github: "signed-in")
        defer { fixture.remove() }
        let path = try fixture.pica.makeRepository("atlas")
        try fixture.openWorkspace("Atlas")
        fixture.element("pica.workspace.addRepository").click()
        let location = fixture.app.textFields["pica.addRepository.location"]
        XCTAssertTrue(location.waitForExistence(timeout: 5), "Add Repository did not open")
        location.typeText("\(path.path)\r")
        let state = fixture.element("pica.workspace.repo.atlas.state")
        XCTAssertTrue(state.waitForExistence(timeout: 10), "atlas was not added")
        XCTAssertEqual(fixture.text("pica.workspace.repo.atlas.state"), "Cloned")
        XCTAssertFalse(fixture.element("pica.addRepository").exists, "Add Repository stayed open")
        fixture.quit()
    }
}

@MainActor
private final class WorkspacesFixture {
    let pica: PicaUnderTest
    let app: XCUIApplication

    init(github: String) throws {
        pica = try PicaUnderTest(github: github)
        app = pica.launch()
    }

    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier]
    }

    /// A text's string: SwiftUI exposes it as the label or, for plain text, the value.
    func text(_ identifier: String) -> String {
        let element = element(identifier)
        guard element.exists else { return "" }
        return element.label.isEmpty ? (element.value as? String ?? "") : element.label
    }

    /// Creates a workspace with New Workspace… (⇧⌘N), which selects it. A row the engine adds to an empty sidebar
    /// after launch is not hittable for XCUITest, so the sidebar is not clicked.
    func openWorkspace(_ name: String) throws {
        app.typeKey("n", modifierFlags: [.command, .shift])
        let field = app.textFields["pica.newWorkspace.name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "⇧⌘N did not open New Workspace")
        field.typeText("\(name)\r")
        XCTAssertTrue(
            element("pica.workspace.importTeams").waitForExistence(timeout: 10), "\(name) was not created and opened")
    }

    func waitForFixLog(_ lines: [String]) {
        let log = pica.fixLogPath
        waitUntil("the fix actions \(lines) are carried out", timeout: 5) {
            let logged = (try? String(contentsOfFile: log, encoding: .utf8)) ?? ""
            return logged.split(separator: "\n").map(String.init) == lines
        }
    }

    func quit() {
        pica.quit(app)
    }

    func remove() {
        pica.remove()
    }
}
