import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// Renaming and deleting sessions (docs/navigation-shell.md#renaming-and-deleting-sessions) from the sidebar row's
/// menu, the timeline's title and the ⌘K palette. Sessions play the `sessions` scenario of `fake-picad-scenarios.ts`:
/// the first message ends idle, the second runs until the session is stopped or deleted.
final class SessionRenameDeleteUITests: XCTestCase {
    @MainActor
    func testSessionsAreRenamedAndDeletedFromTheSidebarTheTitleAndThePalette() throws {
        let pica = try PicaUnderTest(scenario: "sessions")
        defer { pica.remove() }
        let app = pica.launch()
        let path = try pica.makeRepository("atlas")
        // Made oldest first, so the sidebar (most recent first) lists working, second, first.
        let made = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            let repo = try await engine.addRepo(at: path, to: workspace)
            var ids: [Id] = []
            for _ in 0..<3 {
                let session = try await engine.createSession(in: workspace, writing: repo, prompt: "Look around")
                _ = try await engine.waitUntilIdle(session.id)
                ids.append(session.id)
            }
            // Distinct titles, so the timeline's header says which session is selected.
            for (id, title) in [(ids[1], "Second"), (ids[2], "Working")] {
                _ = try await engine.request(Methods.SessionRename.self, SessionRenameParams(sessionId: id, title: title))
            }
            try await engine.send("Keep going", to: ids[2])
            return ids
        }
        let (first, second, working) = (made[0], made[1], made[2])
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'pica.sidebar.session.'"))
        waitUntil("the three sessions are in the sidebar", timeout: 15) { rows.count == 3 }
        func row(_ id: Id) -> XCUIElement { app.descendants(matching: .any)["pica.sidebar.session.\(id)"] }
        func shown(_ text: String) -> Bool {
            app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", text, text))
                .firstMatch.exists
        }
        let header = app.descendants(matching: .any)["pica.session.title"].firstMatch

        // From the sidebar row's menu.
        row(first).rightClick()
        app.menuItems["Rename…"].firstMatch.click()
        rename(to: "Release notes", in: app)
        waitUntil("the row shows the new title", timeout: 10) { shown("Release notes") }
        XCTAssertEqual(try title(of: first, pica), "Release notes")

        // From the timeline's title: double-click.
        row(first).click()
        waitUntil("the session is open", timeout: 10) { header.exists && header.label == "Release notes" }
        header.doubleClick()
        rename(to: "Changelog", in: app)
        waitUntil("the title shows the new name", timeout: 10) { header.label == "Changelog" }
        XCTAssertEqual(try title(of: first, pica), "Changelog")

        // From the palette: delete the selected session, after a confirmation naming it.
        app.typeKey("k", modifierFlags: .command)
        let field = app.textFields["pica.palette.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "⌘K did not open the palette")
        field.typeText("Delete Changelog")
        let item = app.descendants(matching: .any)["pica.palette.item.delete-session.\(first)"]
        XCTAssertTrue(item.waitForExistence(timeout: 5), "the palette does not offer to delete the session")
        field.typeKey(.return, modifierFlags: [])
        let confirm = app.buttons["pica.deleteSession.confirm"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "deleting asked for no confirmation")
        XCTAssertTrue(shown("Delete “Changelog”?"), "the confirmation does not name the session")
        confirm.click()
        waitUntil("the row is gone", timeout: 10) { !row(first).exists }
        // `first` was last in the sidebar, so its neighbour above, `second`, is selected.
        waitUntil("the neighbour is selected", timeout: 10) { header.exists && header.label == "Second" }
        XCTAssertFalse(try sessionIds(pica).contains(first))

        // A working session: the confirmation says it is stopped first.
        row(working).rightClick()
        app.menuItems["Delete…"].firstMatch.click()
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        XCTAssertTrue(shown("stops it first"), "the confirmation does not say the working session is stopped")
        confirm.click()
        waitUntil("the working session is gone", timeout: 10) { !row(working).exists }
        XCTAssertEqual(try sessionIds(pica), [second])

        // ⌘1 still selects the first session in the sidebar, from the workspace's row.
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'pica.sidebar.workspace.'"))
            .firstMatch.click()
        app.typeKey("1", modifierFlags: .command)
        waitUntil("⌘1 selects the remaining session", timeout: 5) { header.exists && header.label == "Second" }
        pica.quit(app)
    }

    /// Replaces the rename alert's title and confirms with Return.
    @MainActor
    private func rename(to title: String, in app: XCUIApplication) {
        // SwiftUI may not carry the field's identifier into the alert, so any text field in a dialog or sheet will do.
        let named = app.textFields["pica.renameSession.title"].firstMatch
        let inAlert = app.dialogs.textFields.firstMatch
        let inSheet = app.sheets.textFields.firstMatch
        waitUntil("the rename alert opens", timeout: 5) { named.exists || inAlert.exists || inSheet.exists }
        let field = named.exists ? named : inAlert.exists ? inAlert : inSheet
        guard field.exists else {
            XCTFail("the rename alert did not open: \(app.debugDescription)")
            return
        }
        field.click()
        field.typeKey("a", modifierFlags: .command)
        field.typeText(title)
        field.typeKey(.return, modifierFlags: [])
        waitUntil("the rename alert closes", timeout: 5) { !field.exists }
    }

    @MainActor
    private func title(of sessionId: Id, _ pica: PicaUnderTest) throws -> String {
        try pica.withEngine { engine in
            try await engine.request(Methods.SessionGet.self, BySession(sessionId: sessionId)).session.title
        }
    }

    @MainActor
    private func sessionIds(_ pica: PicaUnderTest) throws -> [Id] {
        try pica.withEngine { engine in
            try await engine.request(Methods.SessionList.self, SessionListParams()).sessions.map(\.id)
        }
    }
}
