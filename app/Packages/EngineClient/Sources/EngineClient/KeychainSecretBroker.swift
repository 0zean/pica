import Foundation
import Security

/// Reads secrets from generic-password items in the user's Keychain: service `service`, account = the secret reference.
public struct KeychainSecretBroker: SecretBroker {
    public let service: String

    public init(service: String = "dev.pica.Pica.secrets") {
        self.service = service
    }

    public func secret(for ref: String) async throws(SecretBrokerError) -> String {
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query(for: ref) as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
                throw .unavailable(ref: ref, status: errSecDecode)
            }
            return value
        case errSecItemNotFound:
            throw .notFound(ref: ref)
        default:
            throw .unavailable(ref: ref, status: status)
        }
    }

    func query(for ref: String) -> [CFString: Any] {
        [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: ref,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
    }
}
