@testable import AppShell
import Darwin
import EngineClient
import Foundation
import PicaProtocol
import Testing

/// PLAN.md A-01: killing the engine shows a reconnecting state and recovers within 2 s.
@Suite(.serialized, .timeLimit(.minutes(1))) struct EngineRecoveryTests {
    /// Recovery is mostly a new Node process starting `picad`, whose time varies with how busy the machine is, so the
    /// check is the median of three kills (H-07, docs/performance.md); each kill restarts at once, with no backoff.
    private static let kills = 3

    @MainActor @Test func killedEngineShowsReconnectingAndRecoversWithinTwoSeconds() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        let supervisor = try fixture.supervisor()
        let model = AppModel(supervisor: supervisor)
        var shown = Observations { model.presentation }.makeAsyncIterator()
        model.start()
        while let presentation = await shown.next(), presentation.style != .hidden {}
        #expect(model.engineStatus.isConnected)

        var recoveries: [Duration] = []
        for _ in 0..<Self.kills {
            let killedEngine = try #require(supervisor.engineProcessIdentifier)
            let killed = ContinuousClock.now
            kill(killedEngine, SIGKILL)
            let reconnecting = await shown.next()
            #expect(reconnecting?.title == "Reconnecting to the engine…")
            #expect(reconnecting?.style == .banner)
            while let presentation = await shown.next(), presentation.style != .hidden {}
            recoveries.append(ContinuousClock.now - killed)
            #expect(model.engineStatus.isConnected)
            let restarted = try #require(supervisor.engineProcessIdentifier)
            #expect(restarted != killedEngine)
            let health = try await supervisor.client.request(Methods.EngineHealth.self, Empty())
            #expect(health.status == .ok)
        }
        let seconds = recoveries.map { Double($0.components.seconds) + Double($0.components.attoseconds) / 1e18 }
        let recovered = median(seconds)
        print("A-01 engine recovery (s): \(seconds), median \(recovered)")
        BudgetRecord(id: "engine-recovery", measured: recovered * 1000, threshold: 2000, unit: "ms", samples: seconds.map { $0 * 1000 })
            .write()
        #expect(recovered < 2, "median recovery \(recovered) s; recoveries \(seconds)")
        await supervisor.stop()
    }

    @Test func anEngineAlreadyListeningIsUsedAndReplacedWhenItDies() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        // Another client (the CLI) started this engine; the supervisor did not.
        let other = try EngineProcess.start(try fixture.command(), socketPath: fixture.socketPath, logURL: fixture.logURL)
        #expect(await other.waitUntilReady(timeout: .seconds(10), clock: ContinuousClock()) == .ready)

        let supervisor = try fixture.supervisor()
        var statuses = await supervisor.statuses().makeAsyncIterator()
        await supervisor.start()
        _ = await nextStatus(&statuses) { $0.isConnected }
        #expect(supervisor.engineProcessIdentifier == nil)

        other.kill()
        _ = await nextStatus(&statuses) { $0 == .reconnecting }
        _ = await nextStatus(&statuses) { $0.isConnected }
        let started = try #require(supervisor.engineProcessIdentifier)
        #expect(started != other.processIdentifier)
        await supervisor.stop()
    }

    @Test func stoppingTheSupervisorStopsItsEngine() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        let supervisor = try fixture.supervisor()
        var statuses = await supervisor.statuses().makeAsyncIterator()
        await supervisor.start()
        _ = await nextStatus(&statuses) { $0.isConnected }
        let engine = try #require(supervisor.engineProcessIdentifier)

        await supervisor.stop()
        #expect(await statuses.next() == nil)
        // stop() returns after the engine exited and was reaped, so its pid is gone.
        #expect(kill(engine, 0) != 0, "the engine is still running after stop()")
    }
}
