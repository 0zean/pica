import EngineClient
import Foundation
import PicaProtocol

/// The engine call the terminal makes. `EngineTerminalBackend` makes it over `EngineClient`; tests use a fake.
public protocol TerminalBackend: Sendable {
    /// Where the session works, write roots first.
    func roots(sessionId: Id) async throws -> [SessionRoot]
}

public struct EngineTerminalBackend: TerminalBackend {
    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func roots(sessionId: Id) async throws -> [SessionRoot] {
        try await client.request(Methods.SessionRoots.self, BySession(sessionId: sessionId)).roots
    }
}
