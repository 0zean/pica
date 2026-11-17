import EngineClient
import PicaProtocol
import XCTest

/// PLAN.md A-04: the sidebar follows the engine, the window comes back as it was left, and the sidebar works from
/// the keyboard alone. Each test has its own data directory and engine (`PicaUnderTest`).
final class NavigationShellUITests: XCTestCase {
    @MainActor
    func testAWorkspaceCreatedThroughTheEngineAppearsInTheSidebar() throws {
        let pica = try PicaUnderTest()
        defer { pica.remove() }
        let app = pica.launch()
        let workspace = try pica.withEngine { try await $0.createWorkspace("Atlas") }

        let row = app.descendants(matching: .any)["pica.sidebar.workspace.\(workspace.id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the new workspace is not in the sidebar")
        XCTAssertTrue(app.outlines["pica.sidebar"].staticTexts["Atlas"].exists, "the sidebar does not show the workspace's name")

        // Repos and sessions arrive the same way, through `workspace.changed` and `session.changed`.
        let path = try pica.makeRepository("atlas")
        let (repo, session) = try pica.withEngine { engine in
            let repo = try await engine.addRepo(at: path, to: workspace)
            return (repo, try await engine.createSession(in: workspace, writing: repo))
        }
        XCTAssertTrue(app.descendants(matching: .any)["pica.sidebar.repo.\(repo.id)"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"].waitForExistence(timeout: 5))
        pica.quit(app)
    }

    @MainActor
    func testSelectionAndColumnWidthsAreRestoredAfterRelaunch() throws {
        let pica = try PicaUnderTest()
        defer { pica.remove() }
        var app = pica.launch()
        let path = try pica.makeRepository("atlas")
        let session = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            let repo = try await engine.addRepo(at: path, to: workspace)
            return try await engine.createSession(in: workspace, writing: repo)
        }

        let row = app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        app.typeKey("1", modifierFlags: .command)
        waitUntil("⌘1 selects the session", timeout: 3) { self.selectedRow(in: app) == "session.\(session.id)" }
        app.buttons["pica.toolbar.inspector"].click()
        let inspector = app.descendants(matching: .any)["pica.inspector"]
        XCTAssertTrue(inspector.waitForExistence(timeout: 5), "the inspector did not open")

        // Drag both dividers away from their default positions.
        let sidebar = app.outlines["pica.sidebar"]
        let defaults = Layout(sidebar: sidebar.frame.width, inspector: inspector.frame.width)
        // AppKit keeps the sidebar's width in the app's defaults across runs, so drag towards the middle of its range.
        drag(app.splitters.element(boundBy: 0), by: defaults.sidebar > 300 ? -70 : 70)
        drag(app.splitters.element(boundBy: 1), by: -60)
        let before = Layout(sidebar: sidebar.frame.width, inspector: inspector.frame.width)
        XCTAssertGreaterThan(abs(before.sidebar - defaults.sidebar), 30, "the sidebar divider did not move: \(defaults) → \(before)")
        XCTAssertGreaterThan(abs(before.inspector - defaults.inspector), 30, "the inspector divider did not move: \(defaults) → \(before)")
        XCTAssertEqual(selectedRow(in: app), "session.\(session.id)")

        pica.quit(app)
        app = pica.launch()

        waitUntil("the selection is restored", timeout: 5) { self.selectedRow(in: app) == "session.\(session.id)" }
        XCTAssertEqual(sessionTitle(in: app), "Untitled session")
        let restoredInspector = app.descendants(matching: .any)["pica.inspector"]
        XCTAssertTrue(restoredInspector.waitForExistence(timeout: 5), "the inspector is not shown again")
        let after = Layout(sidebar: app.outlines["pica.sidebar"].frame.width, inspector: restoredInspector.frame.width)
        XCTAssertEqual(after.sidebar, before.sidebar, accuracy: 1, "sidebar width: \(before) → \(after)")
        XCTAssertEqual(after.inspector, before.inspector, accuracy: 1, "inspector width: \(before) → \(after)")
        pica.quit(app)
    }

    @MainActor
    func testEverySidebarItemIsReachableAndActivatableByKeyboardAlone() throws {
        let pica = try PicaUnderTest()
        defer { pica.remove() }
        let app = pica.launch()
        let paths = (try pica.makeRepository("atlas"), try pica.makeRepository("borealis"))
        let seeded = try pica.withEngine { engine in
            var made: [(Workspace, Repo, Session)] = []
            for (name, path) in [("Atlas", paths.0), ("Borealis", paths.1)] {
                let workspace = try await engine.createWorkspace(name)
                let repo = try await engine.addRepo(at: path, to: workspace)
                made.append((workspace, repo, try await engine.createSession(in: workspace, writing: repo)))
            }
            return made
        }
        let (atlas, atlasRepo, atlasSession) = seeded[0]
        let (borealis, borealisRepo, borealisSession) = seeded[1]
        XCTAssertTrue(app.descendants(matching: .any)["pica.sidebar.session.\(borealisSession.id)"].waitForExistence(timeout: 5))

        func expectSelected(_ row: Row, _ step: String) {
            waitUntil("\(step) selects \(row.id)", timeout: 3) { self.selectedRow(in: app) == row.id }
            XCTAssertEqual(sessionTitle(in: app), row.title, "\(step) did not open \(row.id)")
        }
        let rows = [
            Row("workspace.\(atlas.id)", title: "Atlas"), Row("repo.\(atlasRepo.id)", title: "atlas"),
            Row("session.\(atlasSession.id)", title: "Untitled session"),
            Row("workspace.\(borealis.id)", title: "Borealis"), Row("repo.\(borealisRepo.id)", title: "borealis"),
            Row("session.\(borealisSession.id)", title: "Untitled session"),
        ]
        // The sidebar has the focus when the window opens; Down from no selection selects the first row.
        XCTAssertNil(selectedRow(in: app))
        for (index, key) in rows.enumerated() {
            app.typeKey(.downArrow, modifierFlags: [])
            expectSelected(key, "Down \(index + 1)")
        }

        for (index, key) in rows.enumerated().reversed().dropFirst() {
            app.typeKey(.upArrow, modifierFlags: [])
            expectSelected(key, "Up to row \(index + 1)")
        }

        // Left collapses a workspace and Right expands it again; a collapsed workspace's rows are skipped.
        app.typeKey(.leftArrow, modifierFlags: [])
        app.typeKey(.downArrow, modifierFlags: [])
        expectSelected(rows[3], "Left on Atlas, then Down")
        app.typeKey(.upArrow, modifierFlags: [])
        expectSelected(rows[0], "Up")
        app.typeKey(.rightArrow, modifierFlags: [])
        app.typeKey(.downArrow, modifierFlags: [])
        expectSelected(rows[1], "Right on Atlas, then Down")

        // ⌘1–9 select sessions in sidebar order, expanding a collapsed workspace.
        app.typeKey(.upArrow, modifierFlags: [])
        app.typeKey(.leftArrow, modifierFlags: [])
        app.typeKey("1", modifierFlags: .command)
        expectSelected(rows[2], "⌘1 with Atlas collapsed")
        XCTAssertTrue(app.descendants(matching: .any)["pica.sidebar.session.\(atlasSession.id)"].waitForExistence(timeout: 3))
        app.typeKey("2", modifierFlags: .command)
        expectSelected(rows[5], "⌘2")

        // The inspector toggles from the keyboard too.
        app.typeKey("i", modifierFlags: [.command, .option])
        XCTAssertTrue(app.descendants(matching: .any)["pica.inspector"].waitForExistence(timeout: 3))
        pica.quit(app)
    }

    /// The selected sidebar row's identifier without the `pica.sidebar.` prefix, such as `session.<id>`.
    @MainActor
    private func selectedRow(in app: XCUIApplication) -> String? {
        let selected = app.outlines["pica.sidebar"].outlineRows.matching(NSPredicate(format: "selected == true"))
        guard selected.count == 1 else { return nil }
        let row = selected.element(boundBy: 0).descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'pica.sidebar.'")).firstMatch
        guard row.exists else { return nil }
        return String(row.identifier.dropFirst("pica.sidebar.".count))
    }

    /// What the session column says is open.
    @MainActor
    private func sessionTitle(in app: XCUIApplication) -> String? {
        let title = app.descendants(matching: .any)["pica.session.title"]
        return title.exists ? title.label : nil
    }

    private struct Row {
        var id: String
        var title: String
        init(_ id: String, title: String) {
            self.id = id
            self.title = title
        }
    }

    /// Drags a column divider sideways. The first splitter is the sidebar's, the second the inspector's.
    @MainActor
    private func drag(_ splitter: XCUIElement, by offset: CGFloat) {
        let start = splitter.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.click(forDuration: 0.5, thenDragTo: start.withOffset(CGVector(dx: offset, dy: 0)))
    }

    private struct Layout: CustomStringConvertible {
        var sidebar: CGFloat
        var inspector: CGFloat
        var description: String { "sidebar \(sidebar), inspector \(inspector)" }
    }
}
