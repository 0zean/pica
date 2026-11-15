import Foundation
@testable import EngineClient
import Security
import Testing

/// Checks the query `KeychainSecretBroker` would send, without sending it.
@Suite(.timeLimit(.minutes(1))) struct KeychainQueryTests {
    @Test func queryLooksUpOneGenericPasswordByServiceAndReference() {
        let query = KeychainSecretBroker(service: "dev.pica.test").query(for: "mcp/github/token")
        #expect(query[kSecClass] as? String == kSecClassGenericPassword as String)
        #expect(query[kSecAttrService] as? String == "dev.pica.test")
        #expect(query[kSecAttrAccount] as? String == "mcp/github/token")
        #expect(query[kSecReturnData] as? Bool == true)
        #expect(query[kSecMatchLimit] as? String == kSecMatchLimitOne as String)
    }

    @Test func storedItemsStayOnThisDevice() {
        let attributes = KeychainSecretBroker(service: "dev.pica.test").addAttributes(for: "keychain:mcp/x/y", data: Data("v".utf8))
        #expect(attributes[kSecAttrService] as? String == "dev.pica.test")
        #expect(attributes[kSecAttrAccount] as? String == "keychain:mcp/x/y")
        #expect(attributes[kSecValueData] as? Data == Data("v".utf8))
        #expect(attributes[kSecAttrAccessible] as? String == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        #expect(attributes[kSecReturnData] == nil)
    }
}
