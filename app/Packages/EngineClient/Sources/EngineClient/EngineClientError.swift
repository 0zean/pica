import PicaProtocol

public enum EngineClientError: Error, Equatable, Sendable {
    /// No connection is open; `connect()` has not succeeded yet, or the client is reconnecting.
    case notConnected
    /// The connection was lost before the engine answered.
    case disconnected
    /// The engine did not answer within the request's timeout.
    case timedOut(method: String, after: Duration)
    /// The engine answered with an error.
    case engine(RpcError)
    /// The engine's answer did not decode as the method's result type.
    case malformedResponse(method: String)
    /// `close()` was called.
    case closed
    case socket(SocketError)

    /// The stable error code when the engine answered with an error.
    public var code: ErrorCode? {
        guard case .engine(let error) = self else { return nil }
        return error.data?.code
    }
}
