import Foundation
import PicaProtocol
import Testing
@testable import Review

/// A backend over an in-memory repo: one file, two hunks, which move between the lists as they are staged.
actor FakeReviewBackend: ReviewBackend {
    var calls: [String] = []
    var stagedHunks: Set<Int> = []
    var branch = "pica/fix"
    var upstream: String?
    var ahead = 0
    var failNext: String?

    static let hunks = [
        DiffHunk(header: "@@ -1 +1 @@", lines: [DiffLine(kind: .removed, text: "a", oldLine: 1, newLine: nil), DiffLine(kind: .added, text: "A", oldLine: nil, newLine: 1)]),
        DiffHunk(header: "@@ -9 +9 @@", lines: [DiffLine(kind: .removed, text: "z", oldLine: 9, newLine: nil), DiffLine(kind: .added, text: "Z", oldLine: nil, newLine: 9)]),
    ]

    func repos(workspaceId: Id) async throws -> [Repo] {
        [
            Repo(id: "r1", remoteUrl: "https://git.example.com/acme/atlas.git", localPath: "/w/atlas", managed: false, defaultBranch: "main", cloneState: .cloned),
            Repo(id: "r2", remoteUrl: "https://git.example.com/acme/other.git", localPath: "/w/other", managed: false, defaultBranch: "main", cloneState: .cloned),
            Repo(id: "r3", remoteUrl: "https://git.example.com/acme/remote.git", localPath: nil, managed: true, defaultBranch: nil, cloneState: .available),
        ]
    }

    func status(sessionId: Id, repoId: Id) async throws -> GitStatus {
        guard repoId == "r1" else { throw ReviewTestError.notInSession }
        let entries = [StatusEntry(path: "story.txt", originalPath: nil, staged: stagedHunks.isEmpty ? nil : .modified, unstaged: stagedHunks.count == 2 ? nil : .modified, submodule: false)]
        return GitStatus(branch: branch, upstream: upstream, ahead: ahead, behind: 0, entries: entries)
    }

    func diff(sessionId: Id, repoId: Id, staged: Bool) async throws -> [FileDiff] {
        let hunks = Self.hunks.indices.filter { stagedHunks.contains($0) == staged }.map { Self.hunks[$0] }
        return hunks.isEmpty ? [] : [FileDiff(path: "story.txt", originalPath: nil, change: .modified, binary: false, hunks: hunks)]
    }

    func stage(sessionId: Id, repoId: Id, _ target: ChangeTarget) async throws {
        calls.append("stage \(target.path) \(target.hunkIndexes ?? [])")
        let unstaged = Self.hunks.indices.filter { !stagedHunks.contains($0) }
        for index in target.hunkIndexes ?? Array(unstaged.indices) { stagedHunks.insert(unstaged[index]) }
    }

    func unstage(sessionId: Id, repoId: Id, _ target: ChangeTarget) async throws {
        calls.append("unstage \(target.path) \(target.hunkIndexes ?? [])")
        stagedHunks.removeAll()
    }

    func discard(sessionId: Id, repoId: Id, _ target: ChangeTarget) async throws {
        calls.append("discard \(target.path) \(target.hunkIndexes ?? [])")
    }

    func commit(sessionId: Id, repoId: Id, message: String) async throws -> Commit {
        if let failNext {
            self.failNext = nil
            throw ReviewTestError.failed(failNext)
        }
        calls.append("commit \(message)")
        stagedHunks.removeAll()
        ahead += 1
        return Commit(sha: "abcdef0123", author: "Pica Test", timestamp: "2026-11-17T10:00:00Z", subject: String(message.split(separator: "\n")[0]))
    }

    func push(sessionId: Id, repoId: Id) async throws {
        calls.append("push")
        upstream = "origin/\(branch)"
        ahead = 0
    }

    func createPullRequest(sessionId: Id, repoId: Id, title: String, body: String, base: String?) async throws -> PullRequest {
        calls.append("pr \(title) \(base ?? "default")")
        return PullRequest(number: 7, url: "https://git.example.com/acme/atlas/pull/7", head: branch, base: base ?? "main")
    }

    func setFailNext(_ message: String) { failNext = message }
}

enum ReviewTestError: Error, CustomStringConvertible {
    case notInSession
    case failed(String)

    var description: String {
        switch self {
        case .notInSession: "not in session"
        case .failed(let message): message
        }
    }
}

@MainActor
@Suite struct ReviewStoreTests {
    static let session = Session(
        id: "s1", workspaceId: "w1", title: "", state: .idle, writeRoots: [], referenceRoots: [], routingProfile: .off,
        budgetCredits: nil, lastSeq: 0, createdAt: "2026-11-17T10:00:00Z", updatedAt: "2026-11-17T10:00:00Z")

    @Test func loadKeepsTheReposTheSessionWritesAndSelectsTheFirstFile() async {
        let store = ReviewStore(session: Self.session, backend: FakeReviewBackend())
        await store.load()
        #expect(store.repos.map(\.name) == ["atlas"])
        #expect(store.unstaged.map(\.id) == ["unstaged:story.txt"])
        #expect(store.selection == "unstaged:story.txt")
        #expect(store.document?.file.hunks.count == 2)
    }

    @Test func stagingAHunkMovesItAndKeepsTheFileSelected() async {
        let backend = FakeReviewBackend()
        let store = ReviewStore(session: Self.session, backend: backend)
        await store.load()
        await store.stage(ChangeTarget(path: "story.txt", hunkIndexes: [1]))
        #expect(await backend.calls == ["stage story.txt [1]"])
        #expect(store.staged.first?.diff.hunks.map(\.header) == ["@@ -9 +9 @@"])
        #expect(store.unstaged.first?.diff.hunks.map(\.header) == ["@@ -1 +1 @@"])
        #expect(store.selection == "unstaged:story.txt")
        #expect(store.document?.file.hunks.map(\.header) == ["@@ -1 +1 @@"])

        // Staging the last unstaged hunk empties the unstaged list; the selection follows the file to the staged one.
        await store.stage(ChangeTarget(path: "story.txt", hunkIndexes: [0]))
        #expect(store.unstaged.isEmpty)
        #expect(store.selection == "staged:story.txt")
    }

    @Test func committingNeedsAMessageAndStagedChangesThenClearsTheMessage() async {
        let backend = FakeReviewBackend()
        let store = ReviewStore(session: Self.session, backend: backend)
        await store.load()
        store.commitMessage = "Fix the story"
        #expect(!store.canCommit, "nothing is staged")
        await store.stage(ChangeTarget(path: "story.txt"))
        store.commitMessage = "   "
        #expect(!store.canCommit, "the message is blank")
        store.commitMessage = "Fix the story\n\nBoth lines."
        #expect(store.canCommit)
        await store.commit()
        #expect(await backend.calls.last == "commit Fix the story\n\nBoth lines.")
        #expect(store.lastCommit?.subject == "Fix the story")
        #expect(store.commitMessage.isEmpty)
        #expect(store.staged.isEmpty)
    }

    @Test func aFailedCommitKeepsTheMessageAndSaysWhy() async {
        let backend = FakeReviewBackend()
        let store = ReviewStore(session: Self.session, backend: backend)
        await store.load()
        await store.stage(ChangeTarget(path: "story.txt"))
        await backend.setFailNext("a hook refused the commit")
        store.commitMessage = "Fix"
        await store.commit()
        #expect(store.activity == .failed("a hook refused the commit"))
        #expect(store.commitMessage == "Fix")
        #expect(store.lastCommit == nil)
    }

    @Test func pushThenPullRequestAreOfferedInTurn() async {
        let backend = FakeReviewBackend()
        let store = ReviewStore(session: Self.session, backend: backend)
        await store.load()
        #expect(store.canPush, "a branch with no upstream can be pushed")
        #expect(!store.canOpenPullRequest)
        await store.push()
        #expect(!store.canPush)
        #expect(store.canOpenPullRequest)
        await store.openPullRequest(title: "Fix", body: "", base: nil)
        #expect(store.pullRequest?.number == 7)
        #expect(await backend.calls == ["push", "pr Fix default"])
    }
}
