/// Answers the engine's `secrets.get` and `secrets.set` requests (§4.5). The app holds secrets; the engine asks
/// for them by reference, and hands over the ones it moves out of imported MCP entries (M-07).
public protocol SecretBroker: Sendable {
    func secret(for ref: String) async throws(SecretBrokerError) -> String
    /// Stores `value` under `ref`, replacing any value already there.
    func store(_ value: String, for ref: String) async throws(SecretBrokerError)
}

public enum SecretBrokerError: Error, Equatable, Sendable {
    case notFound(ref: String)
    /// The store refused or failed the lookup; `status` is its `OSStatus`.
    case unavailable(ref: String, status: Int32)
}
