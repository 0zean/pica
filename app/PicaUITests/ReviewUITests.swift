import EngineClient
import Foundation
import PicaProtocol
import XCTest

/// PLAN.md A-08: stage one hunk, commit, and find the commit in the repository; and draw a 5,000-line diff within the
/// §9 budget. Each test works in a temporary repository under the test's home, which the engine runs git in (the
/// runner cannot run git).
final class ReviewUITests: XCTestCase {
    private static let lineCount = 30

    @MainActor
    func testStagingAHunkAndCommittingRecordsTheCommit() throws {
        let pica = try PicaUnderTest(scenario: "review")
        defer { pica.remove() }
        let app = pica.launch()
        let path = try Self.makeCommittableRepository(pica, "atlas")
        try Self.write(Self.story(), to: path.appending(path: "story.txt"))
        let (session, repo) = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Atlas")
            let repo = try await engine.addRepo(at: path, to: workspace)
            let session = try await engine.createSession(in: workspace, writing: repo)
            try await engine.commitEverything(session.id, repo.id, message: "Start the story")
            return (session, repo)
        }
        XCTAssertTrue(
            app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"].waitForExistence(timeout: 10),
            "the session is not in the sidebar")
        app.typeKey("1", modifierFlags: .command)
        Self.openReview(app)
        XCTAssertTrue(app.descendants(matching: .any)["pica.review.clean"].waitForExistence(timeout: 10), "the review did not open clean")

        // The agent's turn: the file changes on disk, and the review looks again when the turn ends.
        try Self.write(Self.story(editing: [1: "line two", 27: "line twenty-eight"]), to: path.appending(path: "story.txt"))
        try pica.withEngine { engine in
            try await engine.send("rename two lines", to: session.id)
            _ = try await engine.waitUntilIdle(session.id)
        }
        let unstaged = app.descendants(matching: .any)["pica.review.file.unstaged.story.txt"]
        XCTAssertTrue(unstaged.waitForExistence(timeout: 10), "the changed file is not listed")
        unstaged.click()

        // Stage only the second hunk, the change to line 28.
        let stageHunk = app.buttons["pica.review.hunk.1.stage"].firstMatch
        XCTAssertTrue(stageHunk.waitForExistence(timeout: 10), "the second hunk offers no Stage Hunk")
        stageHunk.click()
        XCTAssertTrue(
            app.descendants(matching: .any)["pica.review.file.staged.story.txt"].waitForExistence(timeout: 10),
            "the staged list does not show the file")

        let message = app.descendants(matching: .any)["pica.review.commitMessage"].firstMatch
        message.click()
        message.typeText("Name line 28")
        app.buttons["pica.review.commit"].firstMatch.click()
        let committed = app.descendants(matching: .any)["pica.review.lastCommit"]
        XCTAssertTrue(committed.waitForExistence(timeout: 10), "the review does not say what it committed")

        // The commit is in the repository, with only line 28 in it; line 2 is still an unstaged change.
        let (commits, staged, left) = try pica.withEngine { engine in
            let commits = try await engine.request(Methods.GitLog.self, GitLogParams(repoId: repo.id, limit: 5)).commits
            let staged = try await engine.request(
                Methods.GitDiff.self, GitDiffParams(sessionId: session.id, repoId: repo.id, staged: true)).files
            let left = try await engine.request(
                Methods.GitDiff.self, GitDiffParams(sessionId: session.id, repoId: repo.id, staged: false)).files
            return (commits, staged, left)
        }
        XCTAssertEqual(commits.map(\.subject), ["Name line 28", "Start the story"])
        let head = try String(contentsOf: path.appending(path: ".git/refs/heads/main"), encoding: .utf8)
        XCTAssertEqual(head.trimmingCharacters(in: .whitespacesAndNewlines), commits.first?.sha, "main does not point at the commit")
        XCTAssertTrue(staged.isEmpty, "something is still staged")
        XCTAssertEqual(Self.changedLines(left), ["- line 2", "+ line two"])
        let shown = (committed.value as? String ?? "") + committed.label
        XCTAssertTrue(shown.contains(String(commits.first?.sha.prefix(7) ?? "?")), "the review shows another commit: \(shown)")
        pica.quit(app)
    }

    @MainActor
    func testA5000LineDiffRendersInUnder200Milliseconds() throws {
        let pica = try PicaUnderTest(scenario: "review")
        defer { pica.remove() }
        let app = pica.launch()
        let path = try Self.makeCommittableRepository(pica, "big")
        let lines = 2_500
        let original = (1...lines).map { "    let value\($0) = compute(\($0)) // keep" }
        try Self.write(original, to: path.appending(path: "Big.swift"))
        try Self.write(["small"], to: path.appending(path: "a-small.txt"))
        let session = try pica.withEngine { engine in
            let workspace = try await engine.createWorkspace("Big")
            let repo = try await engine.addRepo(at: path, to: workspace)
            let session = try await engine.createSession(in: workspace, writing: repo)
            try await engine.commitEverything(session.id, repo.id, message: "Start")
            return session
        }
        // Every line changes: 2,500 removed and 2,500 added. The small file sorts first and is selected on opening.
        try Self.write(original.map { $0.replacingOccurrences(of: "// keep", with: "\"fast\" // changed") }, to: path.appending(path: "Big.swift"))
        try Self.write(["small", "changed"], to: path.appending(path: "a-small.txt"))
        XCTAssertTrue(
            app.descendants(matching: .any)["pica.sidebar.session.\(session.id)"].waitForExistence(timeout: 10),
            "the session is not in the sidebar")
        app.typeKey("1", modifierFlags: .command)
        Self.openReview(app)

        let small = app.descendants(matching: .any)["pica.review.file.unstaged.a-small.txt"]
        let big = app.descendants(matching: .any)["pica.review.file.unstaged.Big.swift"]
        XCTAssertTrue(big.waitForExistence(timeout: 20), "the large file is not listed")
        var seconds: [Double] = []
        for _ in 0..<3 {
            small.click()
            waitUntil("the small file is shown", timeout: 10) { (try? self.reports(pica).last?.path) == "a-small.txt" }
            big.click()
            waitUntil("the large diff is drawn", timeout: 10) { (try? self.reports(pica).last?.path) == "Big.swift" }
            let report = try XCTUnwrap(try reports(pica).last)
            XCTAssertEqual(report.lines, 5_000)
            seconds.append(report.renderSeconds)
        }
        let median = seconds.sorted()[1]
        print("A-08: a 5,000-line diff rendered in \(seconds.map { String(format: "%.3f", $0) }) s; median \(median)")
        recordBudget(BudgetMeasurement(
            id: "diff-render", measured: median * 1000, threshold: 200, unit: "ms", samples: seconds.map { $0 * 1000 }))
        XCTAssertLessThan(median, 0.2, "a 5,000-line diff took \(median) s to draw (budget 0.2 s)")
        pica.quit(app)
    }

    /// The toolbar's Review Changes toggle, which XCUITest sees as a toggle or a checkbox, not a button.
    @MainActor
    private static func openReview(_ app: XCUIApplication) {
        let toggle = app.descendants(matching: .any)["pica.toolbar.review"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "the toolbar has no Review Changes")
        toggle.click()
    }

    private struct Report: Decodable {
        let path: String
        let lines: Int
        let renderSeconds: Double
    }

    @MainActor
    private func reports(_ pica: PicaUnderTest) throws -> [Report] {
        try JSONDecoder().decode([Report].self, from: Data(contentsOf: URL(filePath: pica.reviewMetricsPath)))
    }

    /// `makeRepository` with an author for commits, since the engine's git has no user configuration of its own here.
    @MainActor
    private static func makeCommittableRepository(_ pica: PicaUnderTest, _ name: String) throws -> URL {
        let path = try pica.makeRepository(name)
        let config = path.appending(path: ".git/config")
        let identity = "[user]\n\tname = Pica Test\n\temail = test@pica.test\n"
        try (String(contentsOf: config, encoding: .utf8) + identity).write(to: config, atomically: true, encoding: .utf8)
        return path
    }

    private static func story(editing edits: [Int: String] = [:]) -> [String] {
        (0..<lineCount).map { edits[$0] ?? "line \($0 + 1)" }
    }

    private static func write(_ lines: [String], to url: URL) throws {
        try (lines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
    }

    private static func changedLines(_ files: [FileDiff]) -> [String] {
        files.flatMap(\.hunks).flatMap(\.lines).compactMap { line in
            switch line.kind {
            case .added: "+ \(line.text)"
            case .removed: "- \(line.text)"
            case .context: nil
            }
        }
    }
}

extension EngineClient {
    /// Stages every change in the repository and commits it, through the engine.
    func commitEverything(_ sessionId: Id, _ repoId: Id, message: String) async throws {
        let status = try await request(Methods.GitStatus.self, ByWorktree(sessionId: sessionId, repoId: repoId)).status
        for entry in status.entries {
            _ = try await request(Methods.GitStage.self, GitStageParams(sessionId: sessionId, repoId: repoId, path: entry.path))
        }
        _ = try await request(Methods.GitCommit.self, GitCommitParams(sessionId: sessionId, repoId: repoId, message: message))
    }
}
