import EngineClient
import Synchronization

/// A `SecretBroker` over a dictionary, so tests never touch the Keychain.
public final class InMemorySecretBroker: SecretBroker {
    private let storage: Mutex<[String: String]>

    public init(_ secrets: [String: String] = [:]) {
        storage = Mutex(secrets)
    }

    public var secrets: [String: String] {
        storage.withLock { $0 }
    }

    public func secret(for ref: String) async throws(SecretBrokerError) -> String {
        guard let value = storage.withLock({ $0[ref] }) else { throw .notFound(ref: ref) }
        return value
    }

    public func store(_ value: String, for ref: String) async throws(SecretBrokerError) {
        storage.withLock { $0[ref] = value }
    }
}
