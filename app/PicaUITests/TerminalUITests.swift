import Darwin
import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-10: the terminal panel runs a shell in the session's worktree (until R-10, the repo's checkout), and
/// closing the panel ends the shell. The shell is `/bin/sh`, so what the user's own shell prints at start cannot get
/// in the way.
final class TerminalUITests: XCTestCase {
    @MainActor
    func testACommandsOutputAppearsAndItRunsInTheWorktree() throws {
        let pica = try PicaUnderTest()
        defer { pica.remove() }
        let path = try pica.makeRepository("atlas", files: ["README.md": "Atlas\n"]).resolvingSymlinksInPath().path
        let app = pica.launch(extraEnvironment: ["SHELL": "/bin/sh"])
        try openTerminal(app, pica, repository: path)

        let directory = app.descendants(matching: .any)["pica.terminal.directory"]
        XCTAssertTrue(directory.waitForExistence(timeout: 10), "the panel does not say where the shell is")
        XCTAssertEqual(directory.value as? String, path)

        let terminal = terminalView(app)
        terminal.click()
        terminal.typeText("pwd; echo pica-$((6*7))\n")
        waitUntil("the output appears", timeout: 10) { Self.screen(terminal).contains("pica-42") }
        XCTAssertTrue(
            Self.screen(terminal).split(separator: "\n").contains { $0 == path },
            "pwd did not print the worktree:\n\(Self.screen(terminal))")
        pica.quit(app)
    }

    @MainActor
    func testClosingThePanelEndsTheShell() throws {
        let pica = try PicaUnderTest()
        defer { pica.remove() }
        let path = try pica.makeRepository("atlas").path
        let app = pica.launch(extraEnvironment: ["SHELL": "/bin/sh"])
        try openTerminal(app, pica, repository: path)

        // The shell writes its pid when it is hung up, then exits.
        let ended = pica.home.appending(path: "shell-ended")
        let terminal = terminalView(app)
        terminal.click()
        terminal.typeText("trap 'echo $$ > \(ended.path); exit' HUP; echo pid-$$-ready\n")
        waitUntil("the trap is set", timeout: 10) { Self.screen(terminal).contains("-ready") }
        let pid = try XCTUnwrap(Self.screen(terminal).firstMatch(of: /pid-(\d+)-ready/).flatMap { pid_t($0.1) })

        app.buttons["pica.terminal.close"].firstMatch.click()

        XCTAssertFalse(terminalView(app).exists, "the panel is still open")
        waitUntil("the shell is hung up", timeout: 10) { FileManager.default.fileExists(atPath: ended.path) }
        let written = try String(contentsOf: ended, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertEqual(written, String(pid))
        waitUntil("the shell process is gone", timeout: 10) { kill(pid, 0) == -1 && errno == ESRCH }
        pica.quit(app)
    }

    @MainActor
    private func openTerminal(_ app: XCUIApplication, _ pica: PicaUnderTest, repository: String) throws {
        let session = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            let repo = try await engine.addRepo(at: URL(filePath: repository), to: workspace)
            return try await engine.createSession(in: workspace, writing: repo)
        }
        XCTAssertTrue(
            app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"].waitForExistence(timeout: 10),
            "the session is not in the sidebar")
        app.typeKey("1", modifierFlags: .command)
        let toggle = app.descendants(matching: .any)["pica.toolbar.terminal"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "the toolbar has no Terminal button")
        toggle.click()
        XCTAssertTrue(terminalView(app).waitForExistence(timeout: 10), "the terminal did not open")
    }

    @MainActor
    private func terminalView(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["pica.terminal.view"].firstMatch
    }

    @MainActor
    private static func screen(_ terminal: XCUIElement) -> String {
        terminal.value as? String ?? ""
    }
}
