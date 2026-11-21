@testable import AppShell
import Darwin
import EngineClient
import Foundation
import PicaProtocol
import Testing

/// PLAN.md §9 (H-07): event delivery from the engine to the view takes under 5 ms at p99.
///
/// The engine is `picad`'s production composition (`event-latency-picad.ts`), started by the app's supervisor. Its
/// runtime emits paced assistant deltas, each carrying Node's `process.hrtime` when it was emitted. On macOS that is
/// `mach_continuous_time`, as `CLOCK_MONOTONIC_RAW` is, so both processes read one clock (S-07 found the same for
/// `CLOCK_UPTIME_RAW` before the Mac had slept; the two differ by the time asleep). The test reads the same clock on the main actor as each decoded event arrives there, where the app's
/// stores apply events, so a delay covers the engine (normalizing, storing, notifying), the socket, `EngineClient`'s
/// decoding and the hop to the main actor. As S-07 found, one run's tail is at the mercy of the scheduler on a busy
/// machine, so the result is the median of three runs' p99s, after a warm-up run that is not counted.
@Suite(.serialized, .timeLimit(.minutes(2))) struct EventDeliveryLatencyTests {
    private static let budgetMs = 5.0
    private static let entry = EngineFixture.repository
        .appending(path: "engine/packages/server/tests/processes/event-latency-picad.ts")
    private static let events = 1_000
    private static let ratePerSecond = 500
    private static let runs = 3

    @Test func eventDeliveryFromEngineToMainActorIsUnderFiveMillisecondsAtP99() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        let supervisor = EngineSupervisor(
            command: .success(try fixture.command(entry: Self.entry)), socketPath: fixture.socketPath,
            secrets: InMemorySecretBroker())
        var statuses = await supervisor.statuses().makeAsyncIterator()
        await supervisor.start()
        _ = await nextStatus(&statuses) { $0.isConnected }
        let client = supervisor.client
        let workspace = try await client.request(Methods.WorkspaceCreate.self, WorkspaceCreateParams(name: "Atlas")).workspace
        let repo = try await client.request(
            Methods.RepoAddPath.self, RepoAddPathParams(path: try fixture.makeRepository("atlas").path)).repo
        _ = try await client.request(
            Methods.WorkspacePinRepo.self, WorkspacePinRepoParams(workspaceId: workspace.id, repoId: repo.id))

        _ = try await Self.deliveryDelays(client, workspace: workspace, repo: repo)
        var p99s: [Double] = []
        var summaries: [String] = []
        for _ in 0..<Self.runs {
            let delays = try await Self.deliveryDelays(client, workspace: workspace, repo: repo).sorted()
            #expect(delays.count == Self.events, "received \(delays.count) of \(Self.events) deltas")
            let first = try #require(delays.first)
            #expect(first >= 0, "a delta arrived \(first) ms before it was sent: the two processes read different clocks")
            let p99 = delays[Int(Double(delays.count - 1) * 0.99)]
            p99s.append(p99)
            summaries.append(String(format: "p50 %.2f, p99 %.2f, max %.2f", delays[delays.count / 2], p99, delays.last ?? 0))
        }
        let result = median(p99s)
        print("H-07 event delivery (ms), \(Self.events) deltas at \(Self.ratePerSecond)/s per run: \(summaries); median p99 \(result)")
        BudgetRecord(id: "event-delivery", measured: result, threshold: Self.budgetMs, unit: "ms", samples: p99s).write()
        #expect(result < Self.budgetMs, "median p99 \(result) ms; runs \(summaries)")
        await supervisor.stop()
    }

    /// Starts a session, has its runtime stream `events` deltas once the subscription is live, and returns each
    /// delta's delay in milliseconds.
    @MainActor
    private static func deliveryDelays(_ client: EngineClient, workspace: Workspace, repo: Repo) async throws -> [Double] {
        let session = try await client.request(
            Methods.SessionCreate.self,
            SessionCreateParams(workspaceId: workspace.id, writeRepoIds: [repo.id], referenceRepoIds: [], prompt: nil)
        ).session
        var delays: [Double] = []
        var asked = false
        let events = await client.events(sessionId: session.id, afterSeq: 0)
        for try await event in events {
            let received = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)
            if !asked {
                // The first replayed event means the subscription is live, so no streamed delta arrives as a replay.
                // The send runs apart, so this loop never waits on it while deltas queue up.
                asked = true
                let params = SessionSendParams(sessionId: session.id, text: "stream \(Self.events) \(Self.ratePerSecond)", mode: .send)
                Task { _ = try? await client.request(Methods.SessionSend.self, params) }
            }
            guard case .assistantDelta(let delta) = event, let emitted = UInt64(delta.payload.text) else { continue }
            delays.append(Double(Int64(bitPattern: received &- emitted)) / 1_000_000)
            if delays.count == Self.events { break }
        }
        _ = try await client.request(Methods.SessionAbort.self, BySession(sessionId: session.id))
        return delays
    }
}
