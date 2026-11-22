@testable import Composer
import Foundation
import PicaProtocol
import Testing

@MainActor
@Suite struct ComposerStoreTests {
    let backend = FakeBackend()

    func store(_ state: SessionState = .idle, drafts: ComposerDrafts? = nil) async -> ComposerStore {
        let store = ComposerStore(session: .fixture(state: state), backend: backend, drafts: drafts)
        await store.load()
        return store
    }

    /// Types `text` at the end, one character at a time, as the input reports it.
    func type(_ text: String, into store: ComposerStore) {
        for character in text {
            let new = store.text + String(character)
            store.textDidChange(new, caret: new.utf16.count)
        }
    }

    @Test func atOpensRepoAndAgentCompletionsAndReturnInserts() async {
        let store = await store()
        type("look at @", into: store)
        #expect(store.completion?.items.map(\.id) == ["repo.atlas", "repo.beacon", "agent.bulk-reader", "agent.code-writer"])
        type("at", into: store)
        #expect(store.completion?.items.map(\.id) == ["repo.atlas"])
        #expect(store.acceptCompletion())
        #expect(store.text == "look at @atlas ")
        #expect(store.caret == 15)
        #expect(store.completion == nil)
    }

    @Test func filesAreSearchedOnceTypingPauses() async throws {
        let store = await store()
        type("@main", into: store)
        #expect(store.completion == nil)
        try await waitUntil { store.completion != nil }
        #expect(store.completion?.items.map(\.id) == ["file.atlas:src/main.swift"])
        #expect(backend.fileQueries == ["main"])
        store.acceptCompletion()
        #expect(store.text == "@atlas:src/main.swift ")
    }

    @Test func slashOffersSkillsAtTheStartOfALine() async {
        let store = await store()
        type("/re", into: store)
        #expect(store.completion?.items.map(\.id) == ["skill.review"])
        store.acceptCompletion()
        #expect(store.text == "/review ")
        type("now /", into: store)
        #expect(store.completion == nil)
    }

    @Test func arrowsMoveTheSelectionAndWrap() async {
        let store = await store()
        type("@", into: store)
        store.moveSelection(by: 1)
        #expect(store.completion?.selected == 1)
        store.moveSelection(by: -2)
        #expect(store.completion?.selected == 3)
        store.acceptCompletion()
        #expect(store.text == "@code-writer ")
    }

    @Test func escapeHidesCompletionsUntilTheCaretLeavesTheMention() async {
        let store = await store()
        type("@a", into: store)
        store.dismissCompletion()
        type("t", into: store)
        #expect(store.completion == nil)
        type(" @", into: store)
        #expect(store.completion != nil)
    }

    @Test func insertingBeforeASpaceDoesNotAddAnother() async {
        let store = await store()
        store.textDidChange("@at now", caret: 3)
        store.acceptCompletion()
        #expect(store.text == "@atlas now")
        #expect(store.caret == 7)
    }

    @Test func commandReturnSendsWhenIdleAndClearsTheInput() async {
        let store = await store()
        type("hello @atlas", into: store)
        await store.submit()
        #expect(backend.sent == [.init(text: "hello @atlas\n\n---\n@atlas: /work/atlas", mode: .send)])
        #expect(store.text == "")
        #expect(store.status == nil)
    }

    @Test func sendingWhileRunningQueues() async {
        let store = await store(.running)
        #expect(store.primaryMode == .queue)
        type("next", into: store)
        await store.submit()
        #expect(backend.sent == [.init(text: "next", mode: .queue)])
        #expect(store.status == .queued)
    }

    @Test func steerIsOnlyForARunningTurn() async {
        let running = await store(.awaitingApproval)
        type("instead", into: running)
        await running.submit(.steer)
        #expect(backend.sent.last == .init(text: "instead", mode: .steer))
        #expect(running.status == .steered)

        let idle = await store(.idle)
        type("go", into: idle)
        await idle.submit(.steer)
        #expect(backend.sent.last == .init(text: "go", mode: .send))
    }

    @Test func aSendThatLosesTheRaceWithATurnIsQueued() async {
        backend.acceptsSend = false
        let store = await store(.idle)
        type("late", into: store)
        await store.submit()
        #expect(backend.sent == [.init(text: "late", mode: .send), .init(text: "late", mode: .queue)])
        #expect(store.status == .queued)
    }

    @Test func aRefusedMessageIsGivenBack() async {
        backend.failure = FakeBackend.Failure()
        let store = await store()
        type("keep me", into: store)
        await store.submit()
        #expect(store.text == "keep me")
        #expect(store.status == .failed("Failure()"))
    }

    @Test func nothingIsSentWhenBlankOrWhenTheSessionCannotTakeIt() async {
        let idle = await store()
        type("  \n", into: idle)
        #expect(!idle.canSend)
        await idle.submit()
        let ended = await store(.ended)
        type("hi", into: ended)
        #expect(ended.primaryMode == nil)
        await ended.submit()
        #expect(backend.sent.isEmpty)
    }

    @Test func draftsOutliveTheComposer() async {
        let drafts = ComposerDrafts()
        let first = await store(drafts: drafts)
        type("half a thought", into: first)
        let second = await store(drafts: drafts)
        #expect(second.text == "half a thought")
        await second.submit()
        #expect(drafts["s1"] == "")
    }

    @Test func writeReposMentionTheSessionsWorktree() async {
        let store = await store()
        #expect(store.repos.first { $0.name == "atlas" }?.path == "/work/atlas")
        #expect(store.repos.first { $0.name == "beacon" }?.path == "/src/beacon")
    }

    @Test func filesAreNotSearchedAgainOnceTheEngineCannot() async throws {
        backend.filesFail = true
        let store = await store()
        type("@x", into: store)
        // Wait for the failure itself rather than a fixed time: other suites' windows can hold up the main actor.
        try await waitUntil { store.filesUnavailable }
        type("y", into: store)
        try await Task.sleep(for: .milliseconds(150))
        #expect(backend.fileQueries == ["x"])
        #expect(store.completion == nil)
    }

    @Test func theWorkspaceDefaultIsSetSeparatelyFromTheSessionsMode() async {
        let store = await store()
        #expect(store.defaultProfile == .balanced)
        await store.setDefaultProfile(.strict)
        #expect(backend.profiles == [.strict])
        #expect(store.defaultProfile == .strict)
        #expect(store.session.routingProfile == .off)
        #expect(backend.routingCalls.isEmpty)
    }

    /// The mode menu switches this session; the label reads the session the engine answers with.
    @Test func theModePickerSwitchesThisSession() async {
        let store = await store()
        #expect(store.canChangeRouting)
        await store.setProfile(.strict)
        #expect(backend.routingCalls == ["s1 profile=strict tiers=-"])
        #expect(store.session.routingProfile == .strict)
        // Choosing the mode it has already is no call.
        await store.setProfile(.strict)
        #expect(backend.routingCalls.count == 1)
    }

    @Test func theModeCannotChangeDuringATurn() async {
        let store = ComposerStore(session: .fixture(state: .running), backend: backend)
        await store.load()
        #expect(!store.canChangeRouting)
        await store.setProfile(.strict)
        #expect(backend.routingCalls.isEmpty)
        // Stopped sessions take the change; it applies when they resume.
        store.update(session: .fixture(state: .resumable))
        #expect(store.canChangeRouting)
    }

    @Test func aRefusedSwitchIsShownAndTheModeStays() async {
        backend.routingFails = true
        let store = await store()
        await store.setProfile(.balanced)
        #expect(store.session.routingProfile == .off)
        if case .failed = store.status {} else { Issue.record("expected the refusal to be shown, got \(String(describing: store.status))") }
    }

    @Test func aLockedProfileIsReported() async {
        backend.profileLockedBy = "acme"
        let store = await store()
        #expect(store.profileLock == "acme")
    }

    /// The tier picker sets this session's own models; nil returns a tier to the setting in Settings.
    @Test func theTierPickerSetsThisSessionsModels() async {
        let store = await store()
        #expect(store.tierLock == nil)
        #expect(store.sessionTier(.worker) == nil)
        await store.setTier(.worker, to: "model-a")
        #expect(backend.routingCalls == ["s1 profile=- tiers=reasoning=- worker=model-a"])
        #expect(store.sessionTier(.worker) == "model-a")
        await store.setTier(.reasoning, to: "auto")
        #expect(backend.routingCalls.last == "s1 profile=- tiers=reasoning=auto worker=model-a")
        await store.setTier(.worker, to: nil)
        #expect(backend.routingCalls.last == "s1 profile=- tiers=reasoning=auto worker=-")
        #expect(store.sessionTier(.worker) == nil)
        // The defaults in Settings are untouched.
        #expect(store.tiers.map(\.setting) == ["auto", "auto"])
    }

    @Test func aLockedTierPickerNamesThePolicy() async {
        backend.lockedBy = "acme"
        let store = await store()
        #expect(store.tierLock == "acme")
    }

    private func waitUntil(_ condition: @MainActor () -> Bool) async throws {
        for _ in 0..<100 where !condition() {
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(condition())
    }
}

@MainActor
final class FakeBackend: ComposerBackend, @unchecked Sendable {
    struct Sent: Equatable {
        let text: String
        let mode: SendMode
    }

    struct Failure: Error {}

    var sent: [Sent] = []
    var acceptsSend = true
    var failure: Failure?
    var fileQueries: [String] = []
    var profiles: [RoutingProfile] = []
    var filesFail = false
    var tierList = [
        TierAssignment(tier: .reasoning, setting: "auto", resolvedModelId: "model-a"),
        TierAssignment(tier: .worker, setting: "auto", resolvedModelId: "model-b"),
    ]
    var lockedBy: String?
    var profileLockedBy: String?
    var routingCalls: [String] = []
    var routingFails = false

    nonisolated func send(sessionId: Id, text: String, mode: SendMode) async throws -> Bool {
        try await MainActor.run {
            sent.append(Sent(text: text, mode: mode))
            if let failure { throw failure }
            return mode != .send || acceptsSend
        }
    }

    nonisolated func abort(sessionId: Id) async throws {}

    nonisolated func repos(workspaceId: Id) async throws -> [Repo] {
        [.fixture(id: "r1", remoteUrl: "https://git.example.com/acme/atlas.git", localPath: "/src/atlas"),
         .fixture(id: "r2", localPath: "/src/beacon")]
    }

    var agentNames = ["bulk-reader", "code-writer"]

    nonisolated func agents(workspaceId: Id) async throws -> [AgentDef] {
        await MainActor.run { agentNames }.map {
            AgentDef(name: $0, description: "", tier: .worker, tools: [], prompt: "", sourceLayer: .builtin, sourcePath: nil)
        }
    }

    nonisolated func skills(repoIds: [Id]) async -> [String] { ["review", "fix-tests", "review"] }

    nonisolated func files(workspaceId: Id, query: String, limit: Int) async throws -> [QuickOpenHit] {
        let fail = await MainActor.run {
            fileQueries.append(query)
            return filesFail
        }
        if fail { throw Failure() }
        return query == "main" ? [QuickOpenHit(repoId: "r1", path: "src/main.swift", score: 1)] : []
    }

    nonisolated func models() async throws -> [ModelInfo] {
        [ModelInfo(id: "model-a", name: "Model A", prices: nil, allowedByPolicy: true),
         ModelInfo(id: "model-b", name: "Model B", prices: nil, allowedByPolicy: true)]
    }

    nonisolated func tiers() async throws -> [TierAssignment] { await MainActor.run { tierList } }

    nonisolated func tierLock() async throws -> String? { await MainActor.run { lockedBy } }

    nonisolated func profileLock() async throws -> String? { await MainActor.run { profileLockedBy } }

    nonisolated func setRouting(sessionId: Id, profile: RoutingProfile?, modelTiers: SessionModelTiers?) async throws -> Session {
        try await MainActor.run {
            let tiers = modelTiers.map { "reasoning=\($0.reasoning ?? "-") worker=\($0.worker ?? "-")" } ?? "-"
            routingCalls.append("\(sessionId) profile=\(profile?.rawValue ?? "-") tiers=\(tiers)")
            if routingFails { throw Failure() }
            var session = Session.fixture(state: .idle)
            if let profile { session.routingProfile = profile }
            if let modelTiers { session.modelTiers = modelTiers.reasoning == nil && modelTiers.worker == nil ? nil : modelTiers }
            return session
        }
    }


    nonisolated func workspace(_ workspaceId: Id) async throws -> Workspace {
        Workspace(id: workspaceId, name: "Atlas", sources: [], pinnedRepoIds: [], overrides: WorkspaceOverrides(routingProfile: .balanced))
    }

    nonisolated func setDefaultProfile(_ profile: RoutingProfile, workspaceId: Id) async throws {
        await MainActor.run { profiles.append(profile) }
    }
}

extension Session {
    static func fixture(state: SessionState) -> Session {
        Session(
            id: "s1", workspaceId: "w1", title: "Session", state: state,
            writeRoots: [Worktree(repoId: "r1", sessionId: "s1", path: "/work/atlas", branch: "pica/s1")],
            referenceRoots: [], routingProfile: .off, budgetCredits: nil, lastSeq: 0,
            createdAt: "2026-11-16T10:00:00.000Z", updatedAt: "2026-11-16T10:00:00.000Z")
    }
}

extension Repo {
    static func fixture(id: Id = "r", remoteUrl: String? = nil, localPath: String? = nil) -> Repo {
        Repo(id: id, remoteUrl: remoteUrl, localPath: localPath, managed: false, defaultBranch: "main", cloneState: .cloned)
    }
}
