import Foundation
import Observation
import PicaProtocol

/// The Usage dashboard's filters and what the engine last answered for them (docs/usage.md).
@MainActor
@Observable
public final class UsageDashboardStore {
    public var period = UsagePeriod.last7Days
    /// Nil for all workspaces.
    public var workspaceId: Id?
    public private(set) var workspaces: [Workspace] = []
    public private(set) var dashboard: UsageDashboard?
    public private(set) var failure: String?
    public private(set) var isLoading = false

    private let backend: any UsageBackend
    private let now: @Sendable () -> Date
    /// Only the newest load's answer is shown, so a slow answer to old filters cannot replace a newer one.
    private var generation = 0

    public init(backend: any UsageBackend, now: @escaping @Sendable () -> Date = { Date() }) {
        self.backend = backend
        self.now = now
    }

    public func load() async {
        generation += 1
        let current = generation
        let period = period
        let workspaceId = workspaceId
        let date = now()
        isLoading = true
        defer { if current == generation { isLoading = false } }
        do {
            async let workspaces = backend.workspaces()
            async let cap = backend.workspaceDailyCredits()
            async let rollups = Self.rollups(backend, period: period, workspaceId: workspaceId, now: date)
            let (listed, dailyCap, answered) = try await (workspaces, cap, rollups)
            guard current == generation else { return }
            self.workspaces = listed.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            let names = Dictionary(listed.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
            dashboard = UsageDashboard(
                answered, period: period, now: date, workspaceId: workspaceId, names: names, dailyCap: dailyCap)
            failure = nil
        } catch {
            guard current == generation, !(error is CancellationError) else { return }
            failure = UsageFailure.message(error)
        }
    }

    private static func rollups(
        _ backend: any UsageBackend, period: UsagePeriod, workspaceId: Id?, now: Date
    ) async throws -> UsageRollups {
        let bounds = period.bounds(now: now)
        let today = UsagePeriod.today.bounds(now: now)
        func params(_ groupBy: UsageGroupBy) -> UsageRollupParams {
            UsageRollupParams(groupBy: groupBy, from: bounds.from, to: bounds.to, workspaceId: workspaceId)
        }
        async let day = backend.rollup(params(.day))
        async let model = backend.rollup(params(.model))
        async let agent = backend.rollup(params(.agent))
        async let workspace = workspaceId == nil ? backend.rollup(params(.workspace)) : nil
        async let todayByWorkspace = backend.rollup(UsageRollupParams(groupBy: .workspace, from: today.from, to: today.to))
        return try await UsageRollups(
            day: day, model: model, agent: agent, workspace: workspace, todayByWorkspace: todayByWorkspace)
    }
}
