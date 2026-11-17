import PicaSettings
import XCTest

/// PLAN.md A-14: the ⌘K palette lists every action in the registry, a rebound shortcut persists and runs its action,
/// and a setting a managed policy locks is disabled and names the policy (docs/settings.md).
final class SettingsUITests: XCTestCase {
    @MainActor
    func testThePaletteListsEveryActionInTheRegistry() throws {
        let pica = try PicaUnderTest()
        defer { pica.remove() }
        let app = pica.launch()
        app.typeKey("k", modifierFlags: .command)
        let palette = app.descendants(matching: .any)["pica.palette"]
        XCTAssertTrue(palette.waitForExistence(timeout: 5), "⌘K did not open the palette")
        for definition in ActionCatalog.all {
            let row = app.descendants(matching: .any)["pica.palette.item.action.\(definition.id.rawValue)"]
            XCTAssertTrue(row.waitForExistence(timeout: 2), "\(definition.title) is not in the palette")
        }

        // Running one from the palette: the inspector opens.
        let field = app.textFields["pica.palette.field"]
        field.typeText("inspector")
        field.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(app.descendants(matching: .any)["pica.inspector"].waitForExistence(timeout: 5), "the palette did not run the action")
        pica.quit(app)
    }

    @MainActor
    func testAReboundShortcutPersistsAndTriggersItsAction() throws {
        let pica = try PicaUnderTest()
        defer { pica.remove() }
        var app = pica.launch()
        let inspector = app.descendants(matching: .any)["pica.inspector"]
        XCTAssertFalse(inspector.exists, "the inspector starts closed")

        openSettings(app, pane: "Keyboard")
        let recorder = app.buttons["pica.keybindings.toggleInspector"]
        XCTAssertTrue(recorder.waitForExistence(timeout: 5))
        XCTAssertEqual(recorder.value as? String, "alt+cmd+i")
        recorder.click()
        app.typeKey("j", modifierFlags: [.command, .control])
        waitUntil("the new shortcut is shown", timeout: 5) { recorder.value as? String == "ctrl+cmd+j" }
        let written = try String(contentsOf: pica.configFile, encoding: .utf8)
        XCTAssertTrue(written.contains("\"toggleInspector\": \"ctrl+cmd+j\""), "config.jsonc has \(written)")
        app.typeKey("w", modifierFlags: .command)
        pica.quit(app)

        app = pica.launch()
        app.windows.firstMatch.click()
        app.typeKey("i", modifierFlags: [.command, .option])
        XCTAssertFalse(inspector.waitForExistence(timeout: 1), "the old shortcut still opens the inspector")
        app.typeKey("j", modifierFlags: [.command, .control])
        XCTAssertTrue(inspector.waitForExistence(timeout: 5), "the rebound shortcut did not open the inspector after relaunch")
        app.typeKey("j", modifierFlags: [.command, .control])
        waitUntil("the rebound shortcut closes the inspector", timeout: 5) { !inspector.exists }
        pica.quit(app)
    }

    @MainActor
    func testAManagedLockedSettingIsDisabledAndNamesThePolicy() throws {
        let pica = try PicaUnderTest(managedPolicy: #"{ "id": "acme", "config": { "budget": { "sessionCredits": 100 } } }"#)
        defer { pica.remove() }
        let app = pica.launch()
        openSettings(app, pane: "General")

        let locked = app.textFields["pica.settings.budget.sessionCredits"]
        XCTAssertTrue(locked.waitForExistence(timeout: 5))
        waitUntil("the locked value is shown", timeout: 5) { locked.value as? String == "100" }
        XCTAssertFalse(locked.isEnabled, "a locked setting can be edited")
        let lock = app.descendants(matching: .any)["pica.settings.lock.budget.sessionCredits"]
        XCTAssertTrue(lock.waitForExistence(timeout: 5), "the lock is not shown")
        XCTAssertTrue("\(lock.label) \(lock.value ?? "")".contains("acme"), "the lock does not name the policy: \(lock.label)")

        let open = app.textFields["pica.settings.budget.workspaceDailyCredits"]
        XCTAssertTrue(open.isEnabled, "an unlocked setting is disabled")
        XCTAssertFalse(app.descendants(matching: .any)["pica.settings.lock.budget.workspaceDailyCredits"].exists)
        app.typeKey("w", modifierFlags: .command)
        pica.quit(app)
    }

    @MainActor
    private func openSettings(_ app: XCUIApplication, pane: String) {
        app.typeKey(",", modifierFlags: .command)
        let settings = app.descendants(matching: .any)["pica.settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5), "⌘, did not open Settings")
        let tab = app.toolbars.buttons[pane].firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 5), "Settings has no \(pane) pane")
        tab.click()
    }
}
