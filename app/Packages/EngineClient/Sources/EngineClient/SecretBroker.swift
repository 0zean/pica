/// Answers the engine's `secrets.get` requests (§4.5). The app holds secrets; the engine asks for them by reference.
public protocol SecretBroker: Sendable {
    func secret(for ref: String) async throws(SecretBrokerError) -> String
}

public enum SecretBrokerError: Error, Equatable, Sendable {
    case notFound(ref: String)
    /// The store refused or failed the lookup; `status` is its `OSStatus`.
    case unavailable(ref: String, status: Int32)
}
