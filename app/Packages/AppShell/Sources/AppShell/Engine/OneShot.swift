import Foundation
import Synchronization

/// A value that is set once and can be awaited by any number of tasks. A waiting task that is cancelled gets nil.
final class OneShot<Value: Sendable>: Sendable {
    private struct State {
        var value: Value?
        var waiters: [UUID: CheckedContinuation<Value?, Never>] = [:]
    }

    private let state = Mutex(State())

    var value: Value? { state.withLock { $0.value } }

    func resolve(_ value: Value) {
        let waiters = state.withLock { state -> [CheckedContinuation<Value?, Never>] in
            guard state.value == nil else { return [] }
            state.value = value
            defer { state.waiters = [:] }
            return Array(state.waiters.values)
        }
        for waiter in waiters { waiter.resume(returning: value) }
    }

    func wait() async -> Value? {
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                let resolved = state.withLock { state -> Value?? in
                    if let value = state.value { return .some(value) }
                    if Task.isCancelled { return .some(nil) }
                    state.waiters[id] = continuation
                    return .none
                }
                if let resolved { continuation.resume(returning: resolved) }
            }
        } onCancel: {
            let waiter = state.withLock { $0.waiters.removeValue(forKey: id) }
            waiter?.resume(returning: nil)
        }
    }
}
