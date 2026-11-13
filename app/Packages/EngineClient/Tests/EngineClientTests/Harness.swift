import EngineClient
import EngineClientTestSupport
import Foundation
import PicaProtocol

/// A client connected to a scripted server, with a manual clock.
struct Harness {
    let server: ScriptedEngineServer
    let clock: ManualClock
    let client: EngineClient
    let peer: ScriptedPeer

    static func connected(
        secrets: [String: String] = [:],
        configure: (inout EngineClient.Configuration) -> Void = { _ in }
    ) async throws -> Harness {
        let server = try ScriptedEngineServer()
        let clock = ManualClock()
        var configuration = EngineClient.Configuration()
        configure(&configuration)
        let client = EngineClient(
            socketPath: server.socketPath, secrets: InMemorySecretBroker(secrets), clock: clock,
            configuration: configuration)
        async let hello = client.connect()
        let peer = try await server.nextPeer()
        try await peer.acceptHello()
        _ = try await hello
        return Harness(server: server, clock: clock, client: client, peer: peer)
    }

    func shutDown() async {
        await client.close()
        await server.stop()
    }
}

extension ScriptedPeer.Message {
    func param(_ key: String) -> JSONValue? {
        guard case .object(let fields) = params else { return nil }
        return fields[key]
    }
}

extension SessionEvent {
    var seq: Seq? {
        guard case .unknown(let event) = self else { return nil }
        return event.seq
    }
}
