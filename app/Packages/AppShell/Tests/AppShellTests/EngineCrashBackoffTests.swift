@testable import AppShell
import Darwin
import EngineClient
import Foundation
import Testing

/// H-05: an engine that keeps crashing soon after it started is restarted with growing delays, then given up on.
@Suite(.serialized, .timeLimit(.minutes(1))) struct EngineCrashBackoffTests {
    @Test func earlyCrashesInARowBackOffThenFailWithACode() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        var configuration = EngineSupervisor.Configuration()
        configuration.crashRestartDelays = [.zero, .milliseconds(50)]
        configuration.maxEarlyCrashes = 3
        let supervisor = try fixture.supervisor(configuration: configuration)
        var statuses = await supervisor.statuses().makeAsyncIterator()
        await supervisor.start()

        for _ in 0..<2 {
            _ = await nextStatus(&statuses) { $0.isConnected }
            kill(try #require(supervisor.engineProcessIdentifier), SIGKILL)
            _ = await nextStatus(&statuses) { $0 == .reconnecting }
        }
        _ = await nextStatus(&statuses) { $0.isConnected }
        kill(try #require(supervisor.engineProcessIdentifier), SIGKILL)

        let status = await nextStatus(&statuses) { $0.isFailed }
        guard case .failed(let failure)? = status else { return }
        #expect(failure.code == .engineCrashLoop)
        #expect(failure.message.contains("stopped 3 times in a row"), "\(failure.message)")
        #expect(failure.message.contains(fixture.logURL.path))
        let presentation = EngineStatusPresentation(.failed(failure))
        #expect(presentation.title == "The engine keeps stopping")
        #expect(presentation.code == "engine_crash_loop")
        #expect(presentation.offersRetry)
        // The client keeps retrying the socket; that must not start another engine. (A wait for something not to happen.)
        try await Task.sleep(for: .milliseconds(500))
        #expect(supervisor.engineProcessIdentifier == nil)

        // Try Again starts over with a fresh count.
        await supervisor.retry()
        _ = await nextStatus(&statuses) { $0.isConnected }
        await supervisor.stop()
    }

    @Test func restartDelaysGrowWithEachEarlyCrashAndTheLastRepeats() {
        let configuration = EngineSupervisor.Configuration()
        let delays = (1...6).map { EngineSupervisor.crashRestartDelay(after: $0, configuration) }
        #expect(delays == [.zero, .seconds(1), .seconds(2), .seconds(4), .seconds(4), .seconds(4)])
        #expect(configuration.maxEarlyCrashes == 5)
    }
}
