import EngineClient
import EngineClientTestSupport
import Foundation
import PicaProtocol
import Security
import Testing

/// PLAN.md A-02: engine-initiated `secrets.*` requests are answered from the Keychain broker.
/// The client is given an in-memory broker; nothing here reads or writes the real Keychain.
@Suite(.timeLimit(.minutes(1))) struct SecretRequestTests {
    @Test func secretsGetIsAnsweredFromTheBroker() async throws {
        let harness = try await Harness.connected(secrets: ["mcp/datadog/api-key": "dd-test-value"])
        try await harness.peer.request(
            id: .string("eng-1"), method: Methods.SecretsGet.name,
            params: SecretsGetParams(secretRef: "mcp/datadog/api-key"))
        let answer = try await harness.peer.receive()
        #expect(answer.id == .string("eng-1"))
        #expect(answer.error == nil)
        #expect(answer.result == .object(["value": .string("dd-test-value")]))
        await harness.shutDown()
    }

    /// M-07: a secret the engine moved out of an imported MCP entry is kept by the broker.
    @Test func secretsSetStoresTheValueInTheBroker() async throws {
        let broker = InMemorySecretBroker()
        let harness = try await Harness.connected(broker: broker)
        try await harness.peer.request(
            id: .string("engine-2"), method: Methods.SecretsSet.name,
            params: SecretsSetParams(secretRef: "keychain:mcp/github/GITHUB_TOKEN", value: "imported-test-value"))
        let answer = try await harness.peer.receive()
        #expect(answer.id == .string("engine-2"))
        #expect(answer.error == nil)
        #expect(answer.result == .object(["ok": .bool(true)]))
        #expect(broker.secrets == ["keychain:mcp/github/GITHUB_TOKEN": "imported-test-value"])
        await harness.shutDown()
    }

    @Test func secretsSetWithoutAValueIsAnsweredWithInvalidParams() async throws {
        let harness = try await Harness.connected()
        try await harness.peer.request(
            id: .int(10), method: Methods.SecretsSet.name, params: SecretsGetParams(secretRef: "keychain:x"))
        let answer = try await harness.peer.receive()
        #expect(answer.error?.code == RpcErrorNumber.invalidParams.rawValue)
        await harness.shutDown()
    }

    @Test func missingSecretIsAnsweredWithSecretUnresolved() async throws {
        let harness = try await Harness.connected()
        try await harness.peer.request(
            id: .int(7), method: Methods.SecretsGet.name, params: SecretsGetParams(secretRef: "missing"))
        let answer = try await harness.peer.receive()
        #expect(answer.id == .int(7))
        #expect(answer.result == nil)
        #expect(answer.error?.code == RpcErrorNumber.application.rawValue)
        #expect(answer.error?.data?.code == .secretUnresolved)
        #expect(answer.error?.data?.details == ["secretRef": .string("missing")])
        await harness.shutDown()
    }

    @Test func malformedParamsAreAnsweredWithInvalidParams() async throws {
        let harness = try await Harness.connected()
        try await harness.peer.request(id: .int(8), method: Methods.SecretsGet.name, params: ["ref": "x"])
        let answer = try await harness.peer.receive()
        #expect(answer.error?.code == RpcErrorNumber.invalidParams.rawValue)
        #expect(answer.error?.data?.code == .invalidParams)
        await harness.shutDown()
    }

    @Test func unknownEngineMethodIsAnsweredWithMethodNotFound() async throws {
        let harness = try await Harness.connected()
        try await harness.peer.request(id: .int(9), method: "secrets.delete", params: SecretsGetParams(secretRef: "x"))
        let answer = try await harness.peer.receive()
        #expect(answer.id == .int(9))
        #expect(answer.error?.code == RpcErrorNumber.methodNotFound.rawValue)
        #expect(answer.error?.data?.code == .methodNotFound)
        await harness.shutDown()
    }
}
