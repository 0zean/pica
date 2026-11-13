import Synchronization

/// A clock that moves only when a test calls `advance(by:)`, so timeouts and backoff run without real sleeps.
public final class ManualClock: Clock, Sendable {
    public struct Instant: InstantProtocol {
        public var offset: Duration

        public func advanced(by duration: Duration) -> Instant {
            Instant(offset: offset + duration)
        }

        public func duration(to other: Instant) -> Duration {
            other.offset - offset
        }

        public static func < (lhs: Instant, rhs: Instant) -> Bool {
            lhs.offset < rhs.offset
        }
    }

    private struct Sleeper {
        let deadline: Instant
        let continuation: CheckedContinuation<Void, any Error>
    }

    private struct SleeperWaiter {
        let count: Int
        let continuation: CheckedContinuation<Void, Never>
    }

    private struct State {
        var now = Instant(offset: .zero)
        var nextId = 0
        var sleepers: [Int: Sleeper] = [:]
        /// Sleeps cancelled before they were registered.
        var cancelled: Set<Int> = []
        var waiters: [SleeperWaiter] = []

        mutating func readyWaiters() -> [CheckedContinuation<Void, Never>] {
            let ready = waiters.filter { $0.count <= sleepers.count }
            waiters.removeAll { $0.count <= sleepers.count }
            return ready.map(\.continuation)
        }
    }

    private let state = Mutex(State())

    public init() {}

    public var now: Instant {
        state.withLock { $0.now }
    }

    public var minimumResolution: Duration {
        .zero
    }

    public var sleeperCount: Int {
        state.withLock { $0.sleepers.count }
    }

    public func sleep(until deadline: Instant, tolerance: Duration? = nil) async throws {
        let id = state.withLock { state in
            state.nextId += 1
            return state.nextId
        }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                register(id, deadline: deadline, continuation: continuation)
            }
        } onCancel: {
            let sleeper = state.withLock { state in
                if let sleeper = state.sleepers.removeValue(forKey: id) {
                    return Optional(sleeper)
                }
                state.cancelled.insert(id)
                return nil
            }
            sleeper?.continuation.resume(throwing: CancellationError())
        }
    }

    /// Moves time forward and wakes every sleeper whose deadline has passed, earliest first.
    public func advance(by duration: Duration) {
        let due = state.withLock { state in
            state.now = state.now.advanced(by: duration)
            let now = state.now
            let due = state.sleepers.filter { $0.value.deadline <= now }
            for id in due.keys { state.sleepers[id] = nil }
            return due.values.sorted { $0.deadline < $1.deadline }
        }
        for sleeper in due {
            sleeper.continuation.resume()
        }
    }

    /// Returns once at least `count` sleeps are waiting, so a test can advance past a deadline that is already set.
    public func waitForSleepers(_ count: Int = 1) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let ready = state.withLock { state in
                state.waiters.append(SleeperWaiter(count: count, continuation: continuation))
                return state.readyWaiters()
            }
            for waiter in ready { waiter.resume() }
        }
    }

    private func register(_ id: Int, deadline: Instant, continuation: CheckedContinuation<Void, any Error>) {
        enum Outcome {
            case cancelled
            case elapsed
            case waiting([CheckedContinuation<Void, Never>])
        }
        let outcome = state.withLock { state -> Outcome in
            if state.cancelled.remove(id) != nil { return .cancelled }
            if deadline <= state.now { return .elapsed }
            state.sleepers[id] = Sleeper(deadline: deadline, continuation: continuation)
            return .waiting(state.readyWaiters())
        }
        switch outcome {
        case .cancelled:
            continuation.resume(throwing: CancellationError())
        case .elapsed:
            continuation.resume()
        case .waiting(let ready):
            for waiter in ready { waiter.resume() }
        }
    }
}
