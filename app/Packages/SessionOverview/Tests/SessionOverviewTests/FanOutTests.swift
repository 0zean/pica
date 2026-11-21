@testable import SessionOverview
import PicaProtocol
import Testing

func fanOut(
    _ id: Id, created: String, state: FanOutState = .running, runs: [(Id, FanOutRunStatus)]
) -> FanOut {
    let statuses = runs.map(\.1)
    let count = { (match: [FanOutRunStatus]) in statuses.filter(match.contains).count }
    return FanOut(
        id: id, workspaceId: "w1", prompt: "Bump the linter", concurrency: 3, state: state,
        runs: runs.map { repo, status in
            FanOutRun(
                repoId: repo, sessionId: status == .queued ? nil : "session-\(repo)", status: status,
                error: status == .failed ? .init(code: "runtime.error", message: "The model gave up.") : nil)
        },
        counts: .init(
            queued: count([.queued]), active: count([.starting, .running, .awaitingApproval]),
            succeeded: count([.succeeded]), failed: count([.failed]), cancelled: count([.cancelled])),
        createdAt: "2026-11-21T\(created).000Z", updatedAt: "2026-11-21T\(created).000Z")
}

/// PLAN.md A-16: the fan-out aggregate view over R-11's runs (docs/session-overview.md).
@MainActor
@Suite struct FanOutTests {
    @Test func theSummaryReportsEachRepoAndTheCounts() {
        let summary = FanOutSummary(
            fanOut("f1", created: "10:00:00", runs: [
                ("r1", .succeeded), ("r2", .failed), ("r3", .running), ("r4", .queued), ("r5", .queued), ("r6", .cancelled),
            ]),
            workspaceName: "Atlas", repoName: { "repo-\($0)" })
        #expect(summary.runs.map(\.repoName) == ["repo-r1", "repo-r2", "repo-r3", "repo-r4", "repo-r5", "repo-r6"])
        #expect(summary.runs[1].errorMessage == "The model gave up.")
        #expect(summary.runs[3].sessionId == nil)
        #expect(summary.settled == 3)
        #expect(summary.progress == 0.5)
        #expect(summary.countsLine == "3 of 6 done · 1 succeeded · 1 failed · 1 cancelled · 1 running · 2 queued")
        #expect(summary.isActive)
    }

    @Test func aCompletedRunIsNotActive() {
        let summary = FanOutSummary(
            fanOut("f1", created: "10:00:00", state: .completed, runs: [("r1", .succeeded)]),
            workspaceName: "", repoName: { $0 })
        #expect(!summary.isActive)
        #expect(summary.countsLine == "1 of 1 done · 1 succeeded")
    }

    @Test func theStoreListsNewestFirstAndAppliesChanges() async throws {
        let backend = FakeFanOutBackend(listed: [
            fanOut("old", created: "09:00:00", runs: [("r1", .running)]),
            fanOut("new", created: "10:00:00", runs: [("r1", .queued)]),
        ])
        let store = FanOutStore(backend: backend)
        await store.reload()
        #expect(store.fanOuts.map(\.id) == ["new", "old"])

        store.changed(fanOut("old", created: "09:00:00", state: .completed, runs: [("r1", .succeeded)]))
        #expect(store.fanOuts.map(\.id) == ["new", "old"])
        #expect(store.fanOuts[1].state == .completed)
    }

    @Test func aReloadDoesNotUndoAChangeThatArrivedWhileItWasLoading() async throws {
        let stale = fanOut("f1", created: "09:00:00", runs: [("r1", .running)])
        let backend = FakeFanOutBackend(listed: [stale])
        let store = FanOutStore(backend: backend)
        backend.duringList = {
            await store.changed(fanOut("f1", created: "09:00:00", state: .completed, runs: [("r1", .succeeded)]))
        }
        await store.reload()
        #expect(store.fanOuts.first?.state == .completed)
    }

    @Test func cancellingAppliesTheEnginesAnswer() async throws {
        let backend = FakeFanOutBackend(listed: [fanOut("f1", created: "09:00:00", runs: [("r1", .running)])])
        backend.cancelled = fanOut("f1", created: "09:00:00", state: .cancelling, runs: [("r1", .running)])
        let store = FanOutStore(backend: backend)
        await store.reload()
        await store.cancel("f1")
        #expect(backend.cancelledIds == ["f1"])
        #expect(store.fanOuts.first?.state == .cancelling)
    }
}

final class FakeFanOutBackend: FanOutBackend, @unchecked Sendable {
    var listed: [FanOut]
    var cancelled: FanOut?
    var cancelledIds: [Id] = []
    var duringList: (@Sendable () async -> Void)?

    init(listed: [FanOut]) {
        self.listed = listed
    }

    func list() async throws -> [FanOut] {
        let listed = listed
        await duringList?()
        return listed
    }

    func cancel(_ fanOutId: Id) async throws -> FanOut {
        cancelledIds.append(fanOutId)
        guard let cancelled else { throw CancellationError() }
        return cancelled
    }

    func changes() async -> AsyncStream<FanOut> {
        AsyncStream { _ in }
    }

    func connections() async -> AsyncStream<Void> {
        AsyncStream { _ in }
    }
}
