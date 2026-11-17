import EngineClient
import Foundation
import Observation
import PicaProtocol

/// A file in the change list: which list it is in, and its diff.
public struct ReviewFile: Identifiable, Hashable, Sendable {
    public enum Side: String, Hashable, Sendable {
        case staged
        case unstaged
    }

    public let side: Side
    public let diff: FileDiff
    public var id: String { "\(side.rawValue):\(diff.path)" }
    public var path: String { diff.path }
}

public enum DiffLayout: String, CaseIterable, Hashable, Sendable {
    case unified
    case split
}

/// The review of one session's changes (docs/review.md): the repos it writes, their staged and unstaged files, the
/// selected file's diff, and the commit, push and pull request that follow. Each action reloads status and both
/// diffs from the engine, so what is shown is always what git has.
@Observable @MainActor
public final class ReviewStore {
    public struct RepoChoice: Identifiable, Hashable, Sendable {
        public let id: Id
        public let name: String
    }

    public enum Activity: Equatable, Sendable {
        case idle
        case working(String)
        case failed(String)
    }

    public let session: Session
    private let backend: any ReviewBackend

    public private(set) var repos: [RepoChoice] = []
    public private(set) var repoId: Id?
    public private(set) var status: GitStatus?
    public private(set) var staged: [ReviewFile] = []
    public private(set) var unstaged: [ReviewFile] = []
    public private(set) var selection: ReviewFile.ID?
    /// The selected file laid out for drawing; rebuilt only when the selection or its diff changes.
    private(set) var document: DiffDocument?
    public var layout: DiffLayout = .unified
    public var commitMessage = ""
    public private(set) var activity: Activity = .idle
    public private(set) var lastCommit: Commit?
    public private(set) var pullRequest: PullRequest?
    /// False until the first load has finished.
    public private(set) var loaded = false
    /// When the selection last changed, for `ReviewMetrics`.
    @ObservationIgnored private(set) var selectedAt: ContinuousClock.Instant = .now

    public init(session: Session, backend: any ReviewBackend) {
        self.session = session
        self.backend = backend
    }

    public var selectedFile: ReviewFile? {
        guard let selection else { return nil }
        return (staged + unstaged).first { $0.id == selection }
    }

    public var canCommit: Bool {
        !staged.isEmpty && !commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isWorking
    }

    public var isWorking: Bool {
        if case .working = activity { return true }
        return false
    }

    /// The branch has commits the remote does not, or no upstream yet.
    public var canPush: Bool {
        guard let status, status.branch != nil, !isWorking else { return false }
        return status.upstream == nil || status.ahead > 0
    }

    /// Pushed, with nothing left to push.
    public var canOpenPullRequest: Bool {
        guard let status, status.branch != nil, !isWorking else { return false }
        return status.upstream != nil && status.ahead == 0
    }

    /// Finds the repos this session writes: those of its workspace whose status the engine answers for the session.
    public func load() async {
        do {
            let all = try await backend.repos(workspaceId: session.workspaceId)
            var choices: [RepoChoice] = []
            for repo in all where repo.localPath != nil {
                if (try? await backend.status(sessionId: session.id, repoId: repo.id)) != nil {
                    choices.append(RepoChoice(id: repo.id, name: Self.name(of: repo)))
                }
            }
            repos = choices
            repoId = choices.first?.id
            await refresh()
        } catch {
            activity = .failed(Self.describe(error))
        }
        loaded = true
    }

    public func selectRepo(_ id: Id) async {
        guard id != repoId else { return }
        repoId = id
        selection = nil
        document = nil
        pullRequest = nil
        await refresh()
    }

    public func refresh() async {
        guard let repoId else { return }
        do {
            let status = try await backend.status(sessionId: session.id, repoId: repoId)
            let staged = try await backend.diff(sessionId: session.id, repoId: repoId, staged: true)
            let unstaged = try await backend.diff(sessionId: session.id, repoId: repoId, staged: false)
            apply(status: status, staged: staged, unstaged: unstaged)
        } catch {
            activity = .failed(Self.describe(error))
        }
    }

    public func select(_ id: ReviewFile.ID?) {
        selectedAt = .now
        selection = id
        document = selectedFile.map { DiffDocument(file: $0.diff) }
    }

    public func stage(_ target: ChangeTarget) async {
        await perform("Staging \(target.path)") { [backend, session] repoId in
            try await backend.stage(sessionId: session.id, repoId: repoId, target)
        }
    }

    public func unstage(_ target: ChangeTarget) async {
        await perform("Unstaging \(target.path)") { [backend, session] repoId in
            try await backend.unstage(sessionId: session.id, repoId: repoId, target)
        }
    }

    public func discard(_ target: ChangeTarget) async {
        await perform("Discarding \(target.path)") { [backend, session] repoId in
            try await backend.discard(sessionId: session.id, repoId: repoId, target)
        }
    }

    public func stageAll() async {
        let paths = unstaged.map(\.path)
        await perform("Staging all changes") { [backend, session] repoId in
            for path in paths {
                try await backend.stage(sessionId: session.id, repoId: repoId, ChangeTarget(path: path))
            }
        }
    }

    public func commit() async {
        let message = commitMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canCommit else { return }
        var made: Commit?
        await perform("Committing") { [backend, session] repoId in
            made = try await backend.commit(sessionId: session.id, repoId: repoId, message: message)
        }
        if let made {
            lastCommit = made
            commitMessage = ""
        }
    }

    public func push() async {
        await perform("Pushing") { [backend, session] repoId in
            try await backend.push(sessionId: session.id, repoId: repoId)
        }
    }

    public func openPullRequest(title: String, body: String, base: String?) async {
        var opened: PullRequest?
        await perform("Opening a pull request") { [backend, session] repoId in
            opened = try await backend.createPullRequest(
                sessionId: session.id, repoId: repoId, title: title, body: body, base: base)
        }
        if let opened {
            pullRequest = opened
        }
    }

    /// The subject of the last commit, as a pull request's default title.
    public var suggestedPullRequestTitle: String {
        lastCommit?.subject ?? status?.branch ?? ""
    }

    private func perform(_ label: String, _ action: @MainActor (Id) async throws -> Void) async {
        guard let repoId, !isWorking else { return }
        activity = .working(label)
        do {
            try await action(repoId)
            activity = .idle
        } catch {
            activity = .failed(Self.describe(error))
        }
        await refresh()
    }

    private func apply(status: GitStatus, staged: [FileDiff], unstaged: [FileDiff]) {
        self.status = status
        let previous = selectedFile
        self.staged = staged.map { ReviewFile(side: .staged, diff: $0) }
        self.unstaged = unstaged.map { ReviewFile(side: .unstaged, diff: $0) }
        let files = self.staged + self.unstaged
        // Keep the selection on the same file; if its last hunk moved to the other list, follow it there; if it has
        // no changes left, show the first file.
        let next = files.first { $0.id == selection } ?? previous.flatMap { old in files.first { $0.path == old.path } }
            ?? files.first
        if next?.id != selection || next?.diff != previous?.diff {
            select(next?.id)
        }
    }

    static func name(of repo: Repo) -> String {
        let source = repo.remoteUrl ?? repo.localPath ?? repo.id
        let last = source.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init) ?? source
        return last.hasSuffix(".git") ? String(last.dropLast(4)) : last
    }

    static func describe(_ error: any Error) -> String {
        if case .engine(let rpc) = error as? EngineClientError { return rpc.message }
        return String(describing: error)
    }
}
