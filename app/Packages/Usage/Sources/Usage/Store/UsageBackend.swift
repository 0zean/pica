import EngineClient
import PicaProtocol

/// The engine calls the dashboard and the chip make. `EngineUsageBackend` makes them over `EngineClient`; tests use a
/// fake.
public protocol UsageBackend: Sendable {
    func rollup(_ params: UsageRollupParams) async throws -> UsageRollupResult
    func workspaces() async throws -> [Workspace]
    /// `budget.workspaceDailyCredits`, or nil when it is not a number.
    func workspaceDailyCredits() async throws -> Credits?
}

public struct EngineUsageBackend: UsageBackend {
    private let client: EngineClient

    public init(client: EngineClient) {
        self.client = client
    }

    public func rollup(_ params: UsageRollupParams) async throws -> UsageRollupResult {
        try await client.request(Methods.UsageRollup.self, params)
    }

    public func workspaces() async throws -> [Workspace] {
        try await client.request(Methods.WorkspaceList.self).workspaces
    }

    public func workspaceDailyCredits() async throws -> Credits? {
        let value = try await client.request(
            Methods.ConfigGet.self, ConfigGetParams(keyPath: "budget.workspaceDailyCredits")).value.value
        guard case .number(let credits) = value else { return nil }
        return credits
    }
}

/// What a failed load says.
enum UsageFailure {
    static func message(_ error: any Error) -> String {
        if case .engine(let rpc) = error as? EngineClientError { return rpc.message }
        return String(describing: error)
    }
}
