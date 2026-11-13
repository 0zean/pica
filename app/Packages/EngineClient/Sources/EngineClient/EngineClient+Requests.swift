import Foundation
import PicaProtocol

struct PendingRequest {
    let method: String
    let timeout: Duration
    let continuation: CheckedContinuation<Data, any Error>
    let timer: Task<Void, Never>
}

extension EngineClient {
    /// Calls `method` on the engine. Throws `EngineClientError`, or `CancellationError` if the calling task is cancelled.
    /// `timeout` defaults to `Configuration.requestTimeout`.
    public func request<Method: PicaMethod>(
        _ method: Method.Type, _ params: Method.Params, timeout: Duration? = nil
    ) async throws -> Method.Result {
        precondition(Method.direction == .client, "\(Method.name) is sent by the engine, not the client")
        let line = try await send(Method.name, params, timeout: timeout ?? configuration.requestTimeout)
        guard let envelope = try? decoder.decode(ResponseEnvelope<Method.Result>.self, from: line) else {
            throw EngineClientError.malformedResponse(method: Method.name)
        }
        if let error = envelope.error {
            throw EngineClientError.engine(error)
        }
        guard let result = envelope.result else {
            throw EngineClientError.malformedResponse(method: Method.name)
        }
        return result
    }

    public func request<Method: PicaMethod>(
        _ method: Method.Type, timeout: Duration? = nil
    ) async throws -> Method.Result where Method.Params == Empty {
        try await request(method, Empty(), timeout: timeout)
    }

    private func send(_ method: String, _ params: some Encodable & Sendable, timeout: Duration) async throws -> Data {
        try Task.checkCancellation()
        guard let connection else { throw EngineClientError.notConnected }
        nextRequestId += 1
        let id = RequestId.int(nextRequestId)
        let frame = try encoder.frame(OutgoingRequest(id: id, method: method, params: params))
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let timer = Task { [clock] in
                    do {
                        try await clock.sleep(for: timeout)
                    } catch {
                        return
                    }
                    self.finishRequest(id, throwing: EngineClientError.timedOut(method: method, after: timeout))
                }
                pending[id] = PendingRequest(method: method, timeout: timeout, continuation: continuation, timer: timer)
                connection.send(frame)
            }
        } onCancel: {
            Task { await self.finishRequest(id, throwing: CancellationError()) }
        }
    }

    func resolve(_ id: RequestId, with line: Data) {
        // A response for an id that is no longer pending (timed out or cancelled) is dropped.
        guard let request = pending.removeValue(forKey: id) else { return }
        request.timer.cancel()
        request.continuation.resume(returning: line)
    }

    func finishRequest(_ id: RequestId, throwing error: any Error) {
        guard let request = pending.removeValue(forKey: id) else { return }
        request.timer.cancel()
        request.continuation.resume(throwing: error)
    }

    func failPendingRequests(with error: EngineClientError) {
        let failed = pending
        pending = [:]
        for request in failed.values {
            request.timer.cancel()
            request.continuation.resume(throwing: error)
        }
    }
}
