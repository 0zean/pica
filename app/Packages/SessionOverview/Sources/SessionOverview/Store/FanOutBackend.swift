import EngineClient
import PicaProtocol

/// The engine calls the fan-out view makes. `EngineFanOutBackend` makes them over `EngineClient`; tests use a fake.
public protocol FanOutBackend: Sendable {
    func list() async throws -> [FanOut]
    func cancel(_ fanOutId: Id) async throws -> FanOut
    /// Each `fanout.changed`, with the whole aggregate.
    func changes() async -> AsyncStream<FanOut>
    /// Yields once per connection to the engine, including the current one.
    func connections() async -> AsyncStream<Void>
}

public struct EngineFanOutBackend: FanOutBackend {
    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func list() async throws -> [FanOut] {
        try await client.request(Methods.FanoutList.self, FanoutListParams()).fanOuts
    }

    public func cancel(_ fanOutId: Id) async throws -> FanOut {
        try await client.request(Methods.FanoutCancel.self, FanoutCancelParams(fanOutId: fanOutId)).fanOut
    }

    public func changes() async -> AsyncStream<FanOut> {
        let notifications = await client.notifications(Notifications.FanoutChanged.self)
        return AsyncStream { continuation in
            let task = Task {
                for await change in notifications { continuation.yield(change.fanOut) }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func connections() async -> AsyncStream<Void> {
        let states = await client.connectionStates()
        return AsyncStream { continuation in
            let task = Task {
                for await state in states {
                    if case .connected = state { continuation.yield() }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
