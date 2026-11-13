import EngineClient

/// A `SecretBroker` over a fixed dictionary, so tests never touch the Keychain.
public struct InMemorySecretBroker: SecretBroker {
    public let secrets: [String: String]

    public init(_ secrets: [String: String] = [:]) {
        self.secrets = secrets
    }

    public func secret(for ref: String) async throws(SecretBrokerError) -> String {
        guard let value = secrets[ref] else { throw .notFound(ref: ref) }
        return value
    }
}
