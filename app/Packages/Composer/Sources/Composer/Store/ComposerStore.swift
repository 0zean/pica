import EngineClient
import Foundation
import Observation
import PicaProtocol

/// Unsent text per session, so switching sessions keeps what was typed. The app target owns one for the window.
@MainActor
public final class ComposerDrafts {
    private var texts: [Id: String] = [:]

    public init() {}

    public subscript(sessionId: Id) -> String {
        get { texts[sessionId] ?? "" }
        set { texts[sessionId] = newValue.isEmpty ? nil : newValue }
    }
}

/// The composer under a session's timeline (PLAN.md A-06): its text, the completions for what the caret is typing,
/// sending, queueing and steering, and the profile and tier pickers. The text lives in the input; the store hears of
/// each change. Specified in docs/composer.md.
@Observable @MainActor
public final class ComposerStore {
    public struct Completion: Equatable, Sendable {
        public var query: CompletionQuery
        public var items: [CompletionItem]
        public var selected: Int
    }

    public enum Status: Equatable, Sendable {
        case queued
        case steered
        /// The engine is reopening a `resumable` session before the message is sent.
        case resuming
        case failed(String)
    }

    public private(set) var session: Session
    /// True while the input has no text other than whitespace.
    public private(set) var isBlank: Bool
    public private(set) var completion: Completion?
    public private(set) var isSending = false
    public private(set) var status: Status?

    public private(set) var repos: [MentionRepo] = []
    public private(set) var agents: [AgentDef] = []
    public private(set) var skills: [String] = []
    public private(set) var models: [ModelInfo] = []
    public private(set) var tiers: [TierAssignment] = []
    /// The managed policy that locks the tiers; the tier picker is then read-only.
    public private(set) var tierLock: String?
    /// The managed policy that locks `routing.profile`; the mode picker then only shows it.
    public private(set) var profileLock: String?
    /// The profile new sessions in this session's workspace start with.
    public private(set) var defaultProfile: RoutingProfile?
    /// True while a change to this session's mode or models is with the engine.
    public private(set) var isChangingRouting = false
    /// Counts the times the catalogs above were loaded.
    public private(set) var catalogRevision = 0

    /// Each keystroke changes these; nothing on screen reads them, so they are not observed.
    @ObservationIgnored public private(set) var text: String
    @ObservationIgnored public private(set) var caret: Int
    /// Applies an edit the store makes to the input's text (inserting a completion, clearing after a send).
    @ObservationIgnored var editSink: ((ComposerEdit) -> Void)?

    @ObservationIgnored private let backend: any ComposerBackend
    @ObservationIgnored private let drafts: ComposerDrafts?
    @ObservationIgnored private var dismissedQueryStart: Int?
    @ObservationIgnored private var fileSearch: Task<Void, Never>?
    /// Set when the engine could not search files (it does not serve `files.quickOpen` yet); no more searches are made.
    @ObservationIgnored private(set) var filesUnavailable = false
    @ObservationIgnored private var fileHits: (query: String, items: [CompletionItem])?
    @ObservationIgnored private var loadedRepos: [Repo] = []

    static let completionLimit = 8
    /// How long typing must pause before files are searched.
    static let fileSearchDelay: Duration = .milliseconds(60)

    public init(session: Session, backend: any ComposerBackend, drafts: ComposerDrafts? = nil) {
        self.session = session
        self.backend = backend
        self.drafts = drafts
        let draft = drafts?[session.id] ?? ""
        text = draft
        caret = draft.utf16.count
        isBlank = draft.allSatisfy(\.isWhitespace)
    }

    // MARK: Sending

    /// What Return (and ⌘↩) does in the session's state: send when idle, queue behind the running turn, resume and
    /// then send when the engine stopped under the session; nil when the session cannot take a message (starting,
    /// ended, or failed: the engine cannot reopen a failed session).
    public var primaryMode: SendMode? {
        switch session.state {
        case .idle, .resumable: .send
        case .running, .awaitingApproval: .queue
        case .starting, .ended, .failed: nil
        }
    }

    /// Whether the session waits to be resumed (`session.resume`): the engine that ran it stopped, as when Pica quits.
    public var needsResume: Bool { session.state == .resumable }

    /// Whether Resume can be pressed now.
    public var canResume: Bool { needsResume && !isSending }

    /// Whether ⇧⌘↩ steers: only while a turn runs. When idle it sends, as ⌘↩ does.
    public var canSteer: Bool {
        session.state == .running || session.state == .awaitingApproval
    }

    public var isRunning: Bool { canSteer }

    public var canSend: Bool { !isBlank && !isSending && primaryMode != nil }

    /// Sends the text with `mode`, or the session's `primaryMode`. The input is cleared at once and given back if the
    /// engine refuses the message. A `send` that loses a race with a turn starting is queued instead. A `resumable`
    /// session is resumed first; if that fails the text stays in the input and the status says why.
    public func submit(_ requested: SendMode? = nil) async {
        guard canSend else { return }
        isSending = true
        defer { isSending = false }
        if needsResume {
            guard await reopen() else { return }
        }
        guard let primary = primaryMode else { return }
        let mode = requested == .steer && !canSteer ? primary : (requested ?? primary)
        let written = text
        let message = MentionResolver(repos: repos, agents: agents.map(\.name)).message(for: written)
        replaceAll(with: "")
        do {
            var sent = mode
            var accepted = try await backend.send(sessionId: session.id, text: message, mode: mode)
            if !accepted, mode == .send {
                sent = .queue
                accepted = try await backend.send(sessionId: session.id, text: message, mode: .queue)
            }
            guard accepted else {
                restore(written)
                status = .failed("The session did not take the message.")
                return
            }
            status = switch sent {
            case .queue: .queued
            case .steer: .steered
            case .send: nil
            }
        } catch {
            restore(written)
            status = .failed(Self.describe(error))
        }
    }

    /// Resumes a `resumable` session without sending anything.
    public func resume() async {
        guard canResume else { return }
        isSending = true
        defer { isSending = false }
        _ = await reopen()
    }

    /// `session.resume`; true once the session is live again. The caller sets `isSending`.
    private func reopen() async -> Bool {
        status = .resuming
        do {
            let resumed = try await backend.resume(sessionId: session.id)
            status = nil
            if resumed.id == session.id { update(session: resumed) }
            return true
        } catch {
            status = .failed("The session could not be resumed: \(Self.describe(error))")
            return false
        }
    }

    public func stop() async {
        do {
            try await backend.abort(sessionId: session.id)
        } catch {
            status = .failed(Self.describe(error))
        }
    }

    private func restore(_ written: String) {
        if text.isEmpty { replaceAll(with: written) }
    }

    private func replaceAll(with replacement: String) {
        apply(ComposerEdit(range: 0..<text.utf16.count, replacement: replacement, caret: replacement.utf16.count))
    }

    // MARK: The input

    /// Called by the input after each change to its text.
    public func textDidChange(_ text: String, caret: Int) {
        self.text = text
        self.caret = caret
        drafts?[session.id] = text
        let blank = text.allSatisfy(\.isWhitespace)
        if blank != isBlank { isBlank = blank }
        if status != nil, !text.isEmpty { status = nil }
        updateCompletion()
    }

    /// Called by the input when the caret moves without the text changing.
    public func caretDidMove(_ caret: Int) {
        guard caret != self.caret else { return }
        self.caret = caret
        updateCompletion()
    }

    public func update(session: Session) {
        guard session != self.session else { return }
        let reposChanged = session.writeRoots != self.session.writeRoots
        self.session = session
        if reposChanged { repos = loadedRepos.map(mentionRepo) }
    }

    // MARK: Completions

    public func moveSelection(by delta: Int) {
        guard var completion, !completion.items.isEmpty else { return }
        completion.selected = (completion.selected + delta + completion.items.count) % completion.items.count
        self.completion = completion
    }

    /// Inserts the selected completion; false when none is showing.
    @discardableResult
    public func acceptCompletion() -> Bool {
        guard let completion, completion.items.indices.contains(completion.selected) else { return false }
        accept(completion.items[completion.selected])
        return true
    }

    public func accept(_ item: CompletionItem) {
        guard let query = completion?.query else { return }
        apply(ComposerEdit.inserting(item, for: query, in: text))
    }

    /// Hides the completions until the caret leaves the current mention or skill.
    public func dismissCompletion() {
        dismissedQueryStart = completion?.query.range.lowerBound
        completion = nil
    }

    private func apply(_ edit: ComposerEdit) {
        if let editSink {
            editSink(edit)
        } else {
            // No input yet (tests, or before it appears): edit the text here.
            var units = Array(text.utf16)
            units.replaceSubrange(edit.range, with: Array(edit.replacement.utf16))
            textDidChange(String(decoding: units, as: UTF16.self), caret: edit.caret)
        }
    }

    private func updateCompletion() {
        guard let query = MentionTokenizer.activeQuery(in: text, caret: caret) else {
            dismissedQueryStart = nil
            setCompletion(nil)
            return
        }
        guard query.range.lowerBound != dismissedQueryStart else { return }
        dismissedQueryStart = nil
        var items = CompletionRanking.rank(localItems(for: query.kind), query: query.text, limit: Self.completionLimit)
        if query.kind == .mention {
            if let fileHits, fileHits.query == query.text {
                items += fileHits.items.prefix(Self.completionLimit - items.count)
            } else {
                searchFiles(for: query.text)
            }
        }
        let selected = completion.flatMap { old in
            old.query.range.lowerBound == query.range.lowerBound ? items.firstIndex { $0.id == old.items[safe: old.selected]?.id } : nil
        }
        setCompletion(items.isEmpty ? nil : Completion(query: query, items: items, selected: selected ?? 0))
    }

    private func setCompletion(_ new: Completion?) {
        if new != completion { completion = new }
    }

    private func localItems(for kind: ComposerToken.Kind) -> [CompletionItem] {
        switch kind {
        case .mention:
            repos.map { CompletionItem(.repo, $0.name, detail: "Repo") }
                + agents.map { CompletionItem(.agent, $0.name, detail: "Agent · \($0.tier.rawValue)") }
        case .skill:
            skills.map { CompletionItem(.skill, $0, detail: "Skill") }
        }
    }

    /// Searches the workspace's files for `query` once typing pauses, and adds the hits to the completions if the
    /// query is still the one being typed.
    private func searchFiles(for query: String) {
        fileSearch?.cancel()
        guard !query.isEmpty, !filesUnavailable else { return }
        let backend = backend
        let workspaceId = session.workspaceId
        let names = Dictionary(repos.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        fileSearch = Task { [weak self] in
            try? await Task.sleep(for: Self.fileSearchDelay)
            guard !Task.isCancelled else { return }
            let hits: [QuickOpenHit]
            do {
                hits = try await backend.files(workspaceId: workspaceId, query: query, limit: Self.completionLimit)
            } catch {
                self?.filesUnavailable = true
                return
            }
            guard !Task.isCancelled, let self else { return }
            let items = hits.map { hit in
                let repo = names[hit.repoId] ?? hit.repoId
                return CompletionItem(.file, "\(repo):\(hit.path)", detail: "File")
            }
            fileHits = (query, items)
            updateCompletion()
        }
    }

    // MARK: Catalogs and pickers

    /// Loads what completions and pickers offer. A catalog that fails to load stays empty.
    public func load() async {
        let backend = backend
        let workspaceId = session.workspaceId
        async let repoList = try? backend.repos(workspaceId: workspaceId)
        async let agentList = try? backend.agents(workspaceId: workspaceId)
        async let modelList = try? backend.models()
        async let tierList = try? backend.tiers()
        async let lock = try? backend.tierLock()
        async let modeLock = try? backend.profileLock()
        async let workspace = try? backend.workspace(workspaceId)
        loadedRepos = await repoList ?? []
        repos = loadedRepos.map(mentionRepo)
        agents = await agentList ?? []
        models = await modelList ?? []
        tiers = await tierList ?? []
        tierLock = await lock ?? nil
        profileLock = await modeLock ?? nil
        defaultProfile = await workspace?.overrides.routingProfile
        skills = Array(Set(await backend.skills(repoIds: loadedRepos.map(\.id)))).sorted()
        catalogRevision += 1
        updateCompletion()
    }

    public func setDefaultProfile(_ profile: RoutingProfile) async {
        do {
            try await backend.setDefaultProfile(profile, workspaceId: session.workspaceId)
            defaultProfile = profile
        } catch {
            status = .failed(Self.describe(error))
        }
    }

    /// Whether this session's mode and models can change now: the engine takes a change while the session is idle
    /// (it reopens the runtime, so the next turn uses it) or stopped (it applies on resume), not during a turn.
    public var canChangeRouting: Bool {
        !isChangingRouting && (session.state == .idle || session.state == .resumable)
    }

    /// Switches this session's mode (`session.setRouting`).
    public func setProfile(_ profile: RoutingProfile) async {
        guard profile != session.routingProfile else { return }
        await changeRouting(profile: profile, tiers: nil)
    }

    /// This session's own setting for a tier (a model id or "auto"), or nil when it follows the one in Settings.
    public func sessionTier(_ tier: Tier) -> String? {
        switch tier {
        case .reasoning: session.modelTiers?.reasoning
        case .worker: session.modelTiers?.worker
        }
    }

    /// Sets this session's model for a tier (`session.setRouting`); nil returns the tier to the setting in Settings.
    public func setTier(_ tier: Tier, to setting: String?) async {
        guard setting != sessionTier(tier) else { return }
        var tiers = session.modelTiers ?? SessionModelTiers()
        switch tier {
        case .reasoning: tiers.reasoning = setting
        case .worker: tiers.worker = setting
        }
        await changeRouting(profile: nil, tiers: tiers)
    }

    private func changeRouting(profile: RoutingProfile?, tiers: SessionModelTiers?) async {
        guard canChangeRouting else { return }
        isChangingRouting = true
        defer { isChangingRouting = false }
        do {
            let changed = try await backend.setRouting(sessionId: session.id, profile: profile, modelTiers: tiers)
            update(session: changed)
            if case .failed = status { status = nil }
        } catch {
            status = .failed(Self.describe(error))
        }
    }

    private func mentionRepo(_ repo: Repo) -> MentionRepo {
        let worktree = session.writeRoots.first { $0.repoId == repo.id }?.path
        return MentionRepo(id: repo.id, name: MentionRepo.name(of: repo), path: worktree ?? repo.localPath)
    }

    private static func describe(_ error: any Error) -> String {
        if case .engine(let rpc) = error as? EngineClientError { return rpc.message }
        return String(describing: error)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
