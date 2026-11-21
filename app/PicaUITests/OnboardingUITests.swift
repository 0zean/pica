import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-15: onboarding's precondition checks against `fake-picad`, which answers them from
/// `PicaUnderTest.preconditionsFile` on every check (`fake-preconditions.ts`), so a test fails a check and then fixes
/// it while Pica runs. Fix actions are logged to `PicaUnderTest.fixLogPath` instead of writing the pasteboard.
final class OnboardingUITests: XCTestCase {
    @MainActor
    func testEachFailingPreconditionShowsAFixActionAndPassingItAdvances() throws {
        let pica = try PicaUnderTest(onboarding: true)
        defer { pica.remove() }
        var failing = ["copilot": "signed_out", "gitInstall": "missing", "github": "signed-out"]
        try pica.setPreconditions(failing)
        let app = pica.launch()
        XCTAssertTrue(app.descendants(matching: .any)["pica.onboarding"].waitForExistence(timeout: 10), "onboarding is not shown")

        let steps: [(id: String, label: String, logged: String)] = [
            ("copilot", "Copy Sign-In Command", "copy copilot login"),
            ("gitInstall", "Copy Install Command", "copy xcode-select --install"),
            ("github", "Sign in to ghe.example.test", "copy gh auth login --hostname ghe.example.test --scopes read:org"),
        ]
        for (index, step) in steps.enumerated() {
            let fix = app.buttons["pica.onboarding.\(step.id).fix"]
            XCTAssertTrue(fix.waitForExistence(timeout: 10), "failing \(step.id) shows no fix: \(app.debugDescription)")
            XCTAssertEqual(fix.label, step.label)
            XCTAssertEqual(stepState(step.id, in: app), "failed")
            for later in steps[(index + 1)...] {
                XCTAssertFalse(app.buttons["pica.onboarding.\(later.id).fix"].exists, "\(later.id) is shown before \(step.id) passes")
            }
            fix.click()
            waitForFixLog(steps[...index].map(\.logged), pica: pica)
            let note = app.descendants(matching: .any)["pica.onboarding.\(step.id).note"]
            XCTAssertTrue(note.waitForExistence(timeout: 5), "\(step.id)'s fix left no note")

            // The user ran the command; checking again passes and advances.
            failing[step.id] = nil
            try pica.setPreconditions(failing)
            app.buttons["pica.onboarding.\(step.id).recheck"].click()
            waitUntil("\(step.id) passes", timeout: 10) { self.stepState(step.id, in: app) == "passed" }
        }

        createFirstWorkspace("Platform", in: app)
        pica.quit(app)
    }

    @MainActor
    func testOnboardingCanGoOnWithoutGitHub() throws {
        let pica = try PicaUnderTest(onboarding: true)
        defer { pica.remove() }
        try pica.setPreconditions(["github": "signed-out"])
        let app = pica.launch()
        let skip = app.descendants(matching: .any)["pica.onboarding.skipGitHub"]
        XCTAssertTrue(skip.waitForExistence(timeout: 10), "signed out of GitHub offers no way on: \(app.debugDescription)")
        XCTAssertEqual(stepState("copilot", in: app), "passed")
        XCTAssertEqual(stepState("gitInstall", in: app), "passed")
        skip.click()
        XCTAssertEqual(stepState("github", in: app), "skipped")
        createFirstWorkspace("Solo", in: app)
        pica.quit(app)
    }

    /// Creating the first workspace ends onboarding and shows the workspace, where its repos are added.
    @MainActor
    private func createFirstWorkspace(_ name: String, in app: XCUIApplication) {
        let field = app.textFields["pica.onboarding.workspaceName"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the workspace step is not shown")
        field.click()
        field.typeKey("a", modifierFlags: .command)
        field.typeText(name)
        app.buttons["pica.onboarding.createWorkspace"].click()
        let importTeams = app.descendants(matching: .any)["pica.workspace.importTeams"]
        XCTAssertTrue(importTeams.waitForExistence(timeout: 10), "\(name) was not created and opened")
        XCTAssertFalse(app.descendants(matching: .any)["pica.onboarding"].exists, "onboarding stayed open")
    }

    @MainActor
    private func stepState(_ id: String, in app: XCUIApplication) -> String? {
        app.descendants(matching: .any)["pica.onboarding.step.\(id)"].value as? String
    }

    @MainActor
    private func waitForFixLog(_ lines: [String], pica: PicaUnderTest) {
        waitUntil("the fix actions \(lines) are carried out", timeout: 5) {
            let logged = (try? String(contentsOfFile: pica.fixLogPath, encoding: .utf8)) ?? ""
            return logged.split(separator: "\n").map(String.init) == lines
        }
    }
}
