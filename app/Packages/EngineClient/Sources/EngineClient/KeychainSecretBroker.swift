import Foundation
import Security

/// Reads and writes secrets as generic-password items in the user's Keychain: service `service`, account = the secret reference.
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

    public func store(_ value: String, for ref: String) async throws(SecretBrokerError) {
        let data = Data(value.utf8)
        let updated = SecItemUpdate(itemQuery(for: ref) as CFDictionary, [kSecValueData: data] as CFDictionary)
        switch updated {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            let added = SecItemAdd(addAttributes(for: ref, data: data) as CFDictionary, nil)
            guard added == errSecSuccess else { throw .unavailable(ref: ref, status: added) }
        default:
            throw .unavailable(ref: ref, status: updated)
        }
    }

    func itemQuery(for ref: String) -> [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: ref]
    }

    /// The engine reads secrets while the Mac is locked (background sessions), but they never leave this device.
    func addAttributes(for ref: String, data: Data) -> [CFString: Any] {
        itemQuery(for: ref).merging([
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]) { _, new in new }
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
