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

    /// M4's first step: New Session… on the workspace screen starts a session writing to the workspace's only repo
    /// with a first prompt, then selects it, so the session column shows its timeline and composer.
    @MainActor
    func testNewSessionStartsASessionAndOpensIt() throws {
        let fixture = try WorkspacesFixture(github: "signed-in", scenario: "overview")
        defer { fixture.remove() }
        let path = try fixture.pica.makeRepository("atlas")
        try fixture.openWorkspace("Atlas")
        let newSession = fixture.app.buttons["pica.workspace.newSession"]
        XCTAssertTrue(newSession.waitForExistence(timeout: 5), "the workspace screen has no New Session button")
        XCTAssertFalse(newSession.isEnabled, "New Session is enabled in a workspace with no repos")

        let workspace = try fixture.pica.withEngine { engine in
            let workspace = try await engine.request(Methods.WorkspaceList.self).workspaces[0]
            _ = try await engine.addRepo(at: path, to: workspace)
            return workspace
        }
        XCTAssertTrue(fixture.element("pica.workspace.repo.atlas").waitForExistence(timeout: 10), "atlas was not added")
        waitUntil("New Session is enabled", timeout: 5) { newSession.isEnabled }
        newSession.click()

        let prompt = fixture.app.textViews["pica.newSession.prompt"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 5), "New Session did not open")
        XCTAssertTrue(fixture.element("pica.newSession.repo.atlas.role").exists, "atlas cannot be chosen")
        prompt.click()
        prompt.typeText("Check the repo")
        let start = fixture.app.buttons["pica.newSession.start"]
        XCTAssertTrue(start.isEnabled, "Start is off: \(fixture.text("pica.newSession.reason"))")
        start.click()

        XCTAssertTrue(
            fixture.app.textViews["pica.composer.input"].waitForExistence(timeout: 15), "the new session was not opened")
        XCTAssertFalse(fixture.element("pica.newSession").exists, "New Session stayed open")
        let (sessions, roots) = try fixture.pica.withEngine { engine in
            let sessions = try await engine.request(
                Methods.SessionList.self, SessionListParams(workspaceId: workspace.id)).sessions
            let roots = try await engine.request(Methods.SessionRoots.self, BySession(sessionId: sessions[0].id)).roots
            return (sessions, roots)
        }
        XCTAssertEqual(sessions.count, 1)
        let session = try XCTUnwrap(sessions.first)
        XCTAssertEqual(roots.map(\.access), [.write], "the session does not write to atlas alone")
        XCTAssertTrue(
            fixture.element("pica.sidebar.session.\(session.id)").waitForExistence(timeout: 5), "the session is not in the sidebar")
        // The first prompt was sent: the scenario's first turn answers it.
        XCTAssertTrue(
            fixture.app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "Checked the repo.", "Checked the repo."))
                .firstMatch.waitForExistence(timeout: 15),
            "the first prompt's turn is not in the timeline")
        fixture.quit()
    }

    /// Rename… from the workspace screen's menu: another workspace's name is refused as it is typed, a new one is sent
    /// as `workspace.update` and reaches the screen and the sidebar.
    @MainActor
    func testRenamingAWorkspace() throws {
        let fixture = try WorkspacesFixture(github: "signed-in")
        defer { fixture.remove() }
        try fixture.openWorkspace("Payments")
        try fixture.openWorkspace("Platform")

        fixture.element("pica.workspace.menu").click()
        let rename = fixture.app.menuItems["pica.workspaceMenu.rename"]
        XCTAssertTrue(rename.waitForExistence(timeout: 5), "the workspace menu has no Rename…")
        rename.click()
        let field = fixture.app.textFields["pica.renameWorkspace.name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "Rename… did not open")
        XCTAssertEqual(field.value as? String, "Platform")
        field.typeKey("a", modifierFlags: .command)
        field.typeText("payments")
        let save = fixture.app.buttons["pica.renameWorkspace.save"]
        waitUntil("a taken name is refused", timeout: 5) { !save.isEnabled }
        XCTAssertEqual(fixture.text("pica.renameWorkspace.invalid"), "Another workspace is already named “Payments”.")

        field.typeKey("a", modifierFlags: .command)
        field.typeText("Infra\r")
        waitUntil("the workspace screen shows the new name", timeout: 10) {
            fixture.text("pica.session.title") == "Infra"
        }
        XCTAssertFalse(fixture.element("pica.renameWorkspace").exists, "Rename stayed open")
        let names = try fixture.pica.withEngine { engine in
            try await engine.request(Methods.WorkspaceList.self).workspaces.map(\.name)
        }
        XCTAssertEqual(names.sorted(), ["Infra", "Payments"])
        fixture.quit()
    }

    /// Delete Workspace… from the sidebar row's context menu: the confirmation says what goes, the engine ends the
    /// idle session and deletes the workspace with it, and the selection moves to the other workspace.
    @MainActor
    func testDeletingAWorkspaceWithAnIdleSession() throws {
        let fixture = try WorkspacesFixture(github: "signed-in")
        defer { fixture.remove() }
        let path = try fixture.pica.makeRepository("atlas")
        try fixture.openWorkspace("Atlas")
        try fixture.openWorkspace("Beacon")
        let (beacon, session) = try fixture.pica.withEngine { engine in
            let beacon = try await engine.request(Methods.WorkspaceList.self).workspaces.first { $0.name == "Beacon" }!
            let repo = try await engine.addRepo(at: path, to: beacon)
            let session = try await engine.createSession(in: beacon, writing: repo)
            return (beacon, try await engine.waitUntilIdle(session.id))
        }
        XCTAssertTrue(
            fixture.element("pica.sidebar.session.\(session.id)").waitForExistence(timeout: 10), "the session is not in the sidebar")

        fixture.element("pica.sidebar.workspace.\(beacon.id)").rightClick()
        let delete = fixture.app.menuItems["pica.workspaceMenu.delete"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5), "the sidebar row has no Delete Workspace…")
        delete.click()
        let confirm = fixture.app.buttons["Delete Workspace"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "no confirmation")
        let message = fixture.app.staticTexts.containing(
            NSPredicate(format: "value CONTAINS %@ OR label CONTAINS %@", "nothing on disk is deleted", "nothing on disk is deleted"))
        XCTAssertTrue(message.firstMatch.exists, "the confirmation does not say what stays on disk")
        confirm.click()

        waitUntil("Beacon leaves the sidebar", timeout: 10) {
            !fixture.element("pica.sidebar.workspace.\(beacon.id)").exists
        }
        XCTAssertFalse(fixture.element("pica.sidebar.session.\(session.id)").exists, "the session stayed in the sidebar")
        waitUntil("the selection moves to Atlas", timeout: 5) { fixture.text("pica.session.title") == "Atlas" }
        let (names, sessions) = try fixture.pica.withEngine { engine in
            let names = try await engine.request(Methods.WorkspaceList.self).workspaces.map(\.name)
            let sessions = try await engine.request(Methods.SessionList.self, SessionListParams()).sessions
            return (names, sessions)
        }
        XCTAssertEqual(names, ["Atlas"])
        XCTAssertEqual(sessions, [])
        XCTAssertTrue(FileManager.default.fileExists(atPath: path.path), "the repo's folder was deleted")
        fixture.quit()
    }

    /// Removing a repo a team brought in: the confirmation says Sync won't bring it back and nothing is on disk, and
    /// a sync afterwards leaves it out.
    @MainActor
    func testRemovingATeamRepoKeepsItOutOfLaterSyncs() throws {
        let fixture = try WorkspacesFixture(github: "signed-in")
        defer { fixture.remove() }
        try fixture.openWorkspace("Platform")
        try fixture.pica.withEngine { engine in
            let workspace = try await engine.request(Methods.WorkspaceList.self).workspaces[0]
            _ = try await engine.request(
                Methods.WorkspaceAddSource.self,
                WorkspaceAddSourceParams(workspaceId: workspace.id, kind: .team, org: "acme", selector: "platform"))
            _ = try await engine.request(Methods.WorkspaceSync.self, WorkspaceSyncParams(workspaceId: workspace.id))
        }
        let remove = fixture.app.buttons["pica.workspace.repo.beacon.remove"]
        XCTAssertTrue(remove.waitForExistence(timeout: 10), "beacon has no Remove button")
        remove.click()
        let confirm = fixture.app.buttons["Remove from Workspace"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "no confirmation")
        XCTAssertFalse(fixture.app.buttons["Remove and Delete Clone"].exists, "an uncloned repo offers to delete a clone")
        let message = fixture.app.staticTexts.containing(
            NSPredicate(format: "value CONTAINS %@ OR label CONTAINS %@", "Sync won’t add it back", "Sync won’t add it back"))
        XCTAssertTrue(message.firstMatch.exists, "the confirmation does not say Sync won't add it back")
        confirm.click()

        waitUntil("beacon leaves the workspace", timeout: 10) { !fixture.element("pica.workspace.repo.beacon").exists }
        fixture.app.buttons["pica.workspace.sync"].click()
        waitUntil("the sync finishes", timeout: 10) { fixture.text("pica.workspace.syncStatus") == "Up to date." }
        XCTAssertFalse(fixture.element("pica.workspace.repo.beacon").exists, "Sync added beacon back")
        XCTAssertTrue(fixture.element("pica.workspace.repo.atlas").exists, "atlas left the workspace too")
        fixture.quit()
    }
}

@MainActor
private final class WorkspacesFixture {
    let pica: PicaUnderTest
    let app: XCUIApplication

    init(github: String, scenario: String = "empty") throws {
        pica = try PicaUnderTest(scenario: scenario, github: github)
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
