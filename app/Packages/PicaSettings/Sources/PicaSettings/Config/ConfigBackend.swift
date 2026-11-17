import EngineClient
import PicaProtocol

/// `config.get` and `config.set` on the user layer. `EngineConfigBackend` makes them over `EngineClient`; tests use a fake.
public protocol ConfigBackend: Sendable {
    func get(_ keyPath: String) async throws -> ConfigValue
    /// `.null` removes the key from the user's config.jsonc, so the default applies again.
    func set(_ keyPath: String, to value: JSONValue) async throws
    /// `models.list`, for the tier pickers.
    func models() async throws -> [ModelInfo]
}

public struct EngineConfigBackend: ConfigBackend {
    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func get(_ keyPath: String) async throws -> ConfigValue {
        try await client.request(Methods.ConfigGet.self, ConfigGetParams(keyPath: keyPath)).value
    }

    public func set(_ keyPath: String, to value: JSONValue) async throws {
        _ = try await client.request(Methods.ConfigSet.self, ConfigSetParams(keyPath: keyPath, value: value, layer: .user))
    }

    public func models() async throws -> [ModelInfo] {
        try await client.request(Methods.ModelsList.self).models
    }
}

/// What a locked key's control says.
public enum ConfigLock {
    public static func describe(_ value: ConfigValue) -> String? {
        guard value.locked else { return nil }
        return value.lockedBy.map { "Locked by managed policy “\($0)”" } ?? "Locked by managed policy"
    }

    static func message(_ error: any Error) -> String {
        if case .engine(let rpc) = error as? EngineClientError { return rpc.message }
        return String(describing: error)
    }
}
