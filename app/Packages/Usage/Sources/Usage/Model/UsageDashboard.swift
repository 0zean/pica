import Foundation
import PicaProtocol

/// Credits, tokens and calls summed over rollup rows.
public struct UsageTotals: Equatable, Sendable {
    public var credits: Credits = 0
    public var inputTokens = 0
    public var cachedInputTokens = 0
    public var outputTokens = 0
    public var calls = 0

    public init(_ rows: [UsageRollupRow]) {
        for row in rows {
            credits += row.credits
            inputTokens += row.inputTokens
            cachedInputTokens += row.cachedInputTokens
            outputTokens += row.outputTokens
            calls += row.calls
        }
    }

    public var tokens: Int { inputTokens + outputTokens }
}

/// One bar of a by-model, by-agent or by-workspace chart.
public struct UsageBar: Identifiable, Equatable, Sendable {
    public static let otherId = "other"

    public let id: String
    public let label: String
    public let credits: Credits
    public let calls: Int
    public let tokens: Int

    /// Largest credits first, ties by label; at most `limit` bars, the rest summed as "Other".
    static func ranked(_ rows: [UsageRollupRow], label: (String) -> String, limit: Int = 8) -> [UsageBar] {
        let sorted = rows.sorted { a, b in a.credits != b.credits ? a.credits > b.credits : label(a.key) < label(b.key) }
        let shown = sorted.prefix(sorted.count > limit ? limit - 1 : limit).map {
            UsageBar(id: $0.key, label: label($0.key), credits: $0.credits, calls: $0.calls,
                     tokens: $0.inputTokens + $0.outputTokens)
        }
        let rest = UsageTotals(Array(sorted.dropFirst(shown.count)))
        guard rest.calls > 0 else { return shown }
        return shown + [UsageBar(id: otherId, label: "Other", credits: rest.credits, calls: rest.calls, tokens: rest.tokens)]
    }
}

/// One bar of the credits-by-day chart.
public struct DayBar: Identifiable, Equatable, Sendable {
    /// `YYYY-MM-DD`, UTC.
    public let id: String
    public let label: String
    public let credits: Credits
}

/// A workspace whose spend today has reached 75% of `budget.workspaceDailyCredits`.
public struct DailyCapWarning: Identifiable, Equatable, Sendable {
    public let id: Id
    public let workspaceName: String
    public let spentCredits: Credits
    public let capCredits: Credits

    public var fraction: Double { capCredits > 0 ? spentCredits / capCredits : 1 }
    public var tone: UsageTone { UsageTone(fraction: fraction) }
    public var reached: Bool { spentCredits >= capCredits }

    public var message: String {
        let spent = "\(workspaceName) has used \(UsageFormat.credits(spentCredits)) of its \(UsageFormat.credits(capCredits)) daily credits"
        return reached
            ? "\(spent). New sessions are blocked until 00:00 UTC."
            : "\(spent) (\(UsageFormat.percent(fraction)))."
    }
}

/// The engine's answers for one dashboard load.
public struct UsageRollups: Sendable {
    public var day: UsageRollupResult
    public var model: UsageRollupResult
    public var agent: UsageRollupResult
    /// Absent when the dashboard is filtered to one workspace.
    public var workspace: UsageRollupResult?
    /// Today's spend by workspace, whatever the period, for the daily-cap warnings.
    public var todayByWorkspace: UsageRollupResult

    public init(
        day: UsageRollupResult, model: UsageRollupResult, agent: UsageRollupResult, workspace: UsageRollupResult?,
        todayByWorkspace: UsageRollupResult
    ) {
        self.day = day
        self.model = model
        self.agent = agent
        self.workspace = workspace
        self.todayByWorkspace = todayByWorkspace
    }
}

/// What the dashboard draws (docs/usage.md).
public struct UsageDashboard: Equatable, Sendable {
    public let period: UsagePeriod
    public let totals: UsageTotals
    public let savings: SavingsFigure
    public let capWarnings: [DailyCapWarning]
    public let byDay: [DayBar]
    public let byModel: [UsageBar]
    public let byAgent: [UsageBar]
    /// Nil when the dashboard is filtered to one workspace.
    public let byWorkspace: [UsageBar]?

    /// `workspaceId` is the filter, if any; `names` maps workspace ids to names; `dailyCap` is
    /// `budget.workspaceDailyCredits`.
    public init(
        _ rollups: UsageRollups, period: UsagePeriod, now: Date, workspaceId: Id?, names: [Id: String], dailyCap: Credits?
    ) {
        let name = { (id: Id) in names[id] ?? id }
        self.period = period
        totals = UsageTotals(rollups.day.rows)
        savings = SavingsFigure(rollups.day.savings)
        let credits = Dictionary(rollups.day.rows.map { ($0.key, $0.credits) }, uniquingKeysWith: +)
        byDay = period.dayKeys(now: now).map { DayBar(id: $0, label: UTCDay.label($0), credits: credits[$0] ?? 0) }
        byModel = UsageBar.ranked(rollups.model.rows, label: { $0 })
        byAgent = UsageBar.ranked(rollups.agent.rows, label: { $0 })
        byWorkspace = rollups.workspace.map { UsageBar.ranked($0.rows, label: name) }
        capWarnings = Self.capWarnings(rollups.todayByWorkspace.rows, workspaceId: workspaceId, name: name, cap: dailyCap)
    }

    private static func capWarnings(
        _ rows: [UsageRollupRow], workspaceId: Id?, name: (Id) -> String, cap: Credits?
    ) -> [DailyCapWarning] {
        guard let cap else { return [] }
        return rows
            .filter { workspaceId == nil || $0.key == workspaceId }
            .map { DailyCapWarning(id: $0.key, workspaceName: name($0.key), spentCredits: $0.credits, capCredits: cap) }
            .filter { $0.tone != .neutral }
            .sorted { a, b in a.fraction != b.fraction ? a.fraction > b.fraction : a.workspaceName < b.workspaceName }
    }
}
