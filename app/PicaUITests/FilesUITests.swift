import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-09: the Files inspector's tree, ⌘P across the workspace's repos, the read-only viewer, and opening a file
/// in the external editor (logged to `PicaUnderTest.editorLogPath` instead). The engine is `fake-picad` with the
/// `empty` scenario: files need no runtime, only real repos on disk.
final class FilesUITests: XCTestCase {
    @MainActor
    func testTreeOpensAFileInTheViewerAndTheExternalEditor() throws {
        let fixture = try FilesFixture()
        defer { fixture.remove() }
        fixture.app.buttons["pica.toolbar.inspector"].click()
        let inspector = fixture.app.descendants(matching: .any)["pica.inspector"]
        XCTAssertTrue(inspector.waitForExistence(timeout: 5), "the inspector did not open")
        fixture.pica.showInspectorPane("Files", in: fixture.app)
        // The workspace's repos are listed; expanding one lists its root.
        let atlas = fixture.row("atlas:")
        XCTAssertTrue(atlas.waitForExistence(timeout: 5), "the atlas repo is not in the tree")
        XCTAssertTrue(fixture.row("beacon:").exists)
        atlas.click()
        let src = fixture.row("atlas:src")
        XCTAssertTrue(src.waitForExistence(timeout: 5), "atlas's src directory is not listed")
        XCTAssertTrue(fixture.row("atlas:README.md").exists)
        XCTAssertFalse(fixture.row("atlas:build").exists, "an ignored directory is listed")
        src.click()
        let main = fixture.row("atlas:src/main.swift")
        XCTAssertTrue(main.waitForExistence(timeout: 5), "src/main.swift is not listed")

        main.click()
        let viewer = fixture.viewer(showing: "src/main.swift")
        let text = viewer.textViews["pica.viewer.textView"]
        XCTAssertTrue(text.waitForExistence(timeout: 5), "the viewer shows no text")
        XCTAssertEqual(text.value as? String, FilesFixture.mainSwift)

        viewer.buttons["pica.viewer.openExternal"].click()
        fixture.waitForEditor(toOpen: ["src/main.swift"], in: "atlas")
        fixture.quit()
    }

    @MainActor
    func testCommandPFindsFilesAcrossTheWorkspaceRepos() throws {
        let fixture = try FilesFixture()
        defer { fixture.remove() }
        fixture.app.typeKey("p", modifierFlags: .command)
        let field = fixture.app.textFields["pica.quickOpen.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "⌘P did not open quick open")
        field.typeText("mainsw")
        let hit = fixture.app.descendants(matching: .any)["pica.quickOpen.row.atlas:src/main.swift"]
        XCTAssertTrue(hit.waitForExistence(timeout: 5), "mainsw did not find atlas:src/main.swift")
        field.typeKey(.return, modifierFlags: [])
        let text = fixture.viewer(showing: "src/main.swift").textViews["pica.viewer.textView"]
        XCTAssertTrue(text.waitForExistence(timeout: 5), "Return did not open the viewer")

        // A file in the other repo, opened in the external editor with ⌘Return.
        fixture.mainWindow.click()
        fixture.app.typeKey("p", modifierFlags: .command)
        XCTAssertTrue(field.waitForExistence(timeout: 5), "⌘P did not open quick open again")
        field.typeText("pkgswift")
        let other = fixture.app.descendants(matching: .any)["pica.quickOpen.row.beacon:Package.swift"]
        XCTAssertTrue(other.waitForExistence(timeout: 5), "pkgswift did not find beacon:Package.swift")
        field.typeKey(.return, modifierFlags: .command)
        fixture.waitForEditor(toOpen: ["Package.swift"], in: "beacon")
        XCTAssertFalse(field.exists, "quick open stayed open")

        // Escape closes it without opening anything.
        fixture.app.typeKey("p", modifierFlags: .command)
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeKey(.escape, modifierFlags: [])
        waitUntil("quick open closes", timeout: 5) { !field.exists }
        fixture.quit()
    }
}

@MainActor
private final class FilesFixture {
    static let mainSwift = "import Foundation\n\nprint(\"atlas\")\n"

    let pica: PicaUnderTest
    let app: XCUIApplication
    private var repoPaths: [String: URL] = [:]

    init() throws {
        pica = try PicaUnderTest(scenario: "empty")
        app = pica.launch()
        repoPaths["atlas"] = try pica.makeRepository("atlas", files: [
            ".gitignore": "build/\n",
            "README.md": "# Atlas\n",
            "src/main.swift": Self.mainSwift,
            "build/output.txt": "ignored\n",
        ])
        repoPaths["beacon"] = try pica.makeRepository("beacon", files: ["Package.swift": "// swift-tools-version: 6.2\n"])
        let paths = repoPaths
        let session = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Acme")
            var repos: [Repo] = []
            for name in ["atlas", "beacon"] {
                repos.append(try await engine.addRepo(at: paths[name]!, to: workspace))
            }
            let created = try await engine.createSession(in: workspace, writing: repos[0])
            return try await engine.waitUntilIdle(created.id)
        }
        let row = app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the session is not in the sidebar")
        // ⌘1 selects the first session in sidebar order, the only one here; its workspace is the one searched.
        app.typeKey("1", modifierFlags: .command)
    }

    var mainWindow: XCUIElement {
        app.windows.containing(.any, identifier: "pica.root").firstMatch
    }

    func row(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)["pica.files.row.\(id)"]
    }

    /// The viewer window for `path`, once it has opened.
    func viewer(showing path: String) -> XCUIElement {
        let viewer = app.descendants(matching: .any).matching(identifier: "pica.viewer")
            .containing(NSPredicate(format: "identifier == 'pica.viewer.path' AND (label == %@ OR value == %@)", path, path))
            .firstMatch
        XCTAssertTrue(viewer.waitForExistence(timeout: 10), "no viewer opened for \(path)")
        return viewer
    }

    func waitForEditor(toOpen paths: [String], in repo: String) {
        let expected = paths.compactMap { repoPaths[repo]?.appending(path: $0).resolvingSymlinksInPath().path }
        let log = pica.editorLogPath
        waitUntil("the external editor is asked to open \(paths)", timeout: 5) {
            let logged = (try? String(contentsOfFile: log, encoding: .utf8)) ?? ""
            let opened = logged.split(separator: "\n").map { URL(filePath: String($0)).resolvingSymlinksInPath().path }
            return expected.allSatisfy(opened.contains)
        }
    }

    func quit() {
        pica.quit(app)
    }

    func remove() {
        pica.remove()
    }
}
