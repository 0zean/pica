@testable import Usage
import EngineClient
import Foundation
import PicaProtocol

/// `usage.rollup`'s answers over the fixture ledger, which `engine/packages/server/tests/usage/app-fixtures.test.ts`
/// checks against the engine (docs/usage.md).
struct LedgerFixture: Decodable {
    struct WorkspaceName: Decodable {
        let id: Id
        let name: String
    }

    let now: String
    let workspaces: [WorkspaceName]
    let rollups: [String: UsageRollupResult]

    static func load() throws -> LedgerFixture {
        guard let url = Bundle.module.url(forResource: "ledger-rollups", withExtension: "json", subdirectory: "Fixtures")
        else { throw FixtureError.missing }
        return try JSONDecoder().decode(LedgerFixture.self, from: Data(contentsOf: url))
    }

    var date: Date {
        get throws { try Date(now, strategy: .iso8601) }
    }

    var names: [Id: String] {
        Dictionary(uniqueKeysWithValues: workspaces.map { ($0.id, $0.name) })
    }

    func rollup(_ name: String) throws -> UsageRollupResult {
        guard let result = rollups[name] else { throw FixtureError.noRollup(name) }
        return result
    }

    /// The dashboard's rollups for Last 7 Days, for all workspaces or one.
    func weekRollups(workspaceId: Id? = nil) throws -> UsageRollups {
        let prefix = workspaceId.map { "week.\($0)" } ?? "week"
        return UsageRollups(
            day: try rollup("\(prefix).day"), model: try rollup("\(prefix).model"), agent: try rollup("\(prefix).agent"),
            workspace: workspaceId == nil ? try rollup("week.workspace") : nil,
            todayByWorkspace: try rollup("today.workspace"))
    }

    func weekDashboard(workspaceId: Id? = nil, dailyCap: Credits? = 3000) throws -> UsageDashboard {
        UsageDashboard(
            try weekRollups(workspaceId: workspaceId), period: .last7Days, now: try date, workspaceId: workspaceId,
            names: names, dailyCap: dailyCap)
    }
}

enum FixtureError: Error {
    case missing
    case noRollup(String)
}

/// Answers `usage.rollup` from the fixture by the query's name in it, and records the queries.
@MainActor
final class FakeUsageBackend: UsageBackend, @unchecked Sendable {
    let fixture: LedgerFixture
    var dailyCap: Credits? = 3000
    var failure: EngineClientError?
    private(set) var queries: [UsageRollupParams] = []

    init(fixture: LedgerFixture) {
        self.fixture = fixture
    }

    nonisolated func rollup(_ params: UsageRollupParams) async throws -> UsageRollupResult {
        try await MainActor.run {
            queries.append(params)
            if let failure { throw failure }
            return try fixture.rollup(Self.name(params))
        }
    }

    nonisolated func workspaces() async throws -> [Workspace] {
        await MainActor.run {
            fixture.workspaces.map {
                Workspace(id: $0.id, name: $0.name, sources: [], pinnedRepoIds: [], overrides: WorkspaceOverrides())
            }
        }
    }

    nonisolated func workspaceDailyCredits() async throws -> Credits? {
        await MainActor.run { dailyCap }
    }

    /// "week.ws-1.day", "today.workspace", "session.s-2.agent".
    nonisolated static func name(_ params: UsageRollupParams) -> String {
        if let sessionId = params.sessionId { return "session.\(sessionId).\(params.groupBy.rawValue)" }
        var parts = [params.from == "2026-11-16T00:00:00.000Z" ? "today" : "week"]
        if let workspaceId = params.workspaceId { parts.append(workspaceId) }
        parts.append(params.groupBy.rawValue)
        return parts.joined(separator: ".")
    }
}
