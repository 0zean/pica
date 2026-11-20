@testable import Usage
import EngineClient
import Foundation
import PicaProtocol
import Testing

/// PLAN.md A-11: the dashboard's view model from the ledger fixture (docs/usage.md).
@MainActor
@Suite struct UsageDashboardTests {
    let fixture: LedgerFixture

    init() throws {
        fixture = try LedgerFixture.load()
    }

    private func store(_ backend: FakeUsageBackend) throws -> UsageDashboardStore {
        let now = try fixture.date
        return UsageDashboardStore(backend: backend, now: { now })
    }

    @Test func lastSevenDaysAsksForWholeUTCDaysEndingToday() async throws {
        let backend = FakeUsageBackend(fixture: fixture)
        try await store(backend).load()
        let week = backend.queries.filter { $0.from == "2026-11-10T00:00:00.000Z" }
        #expect(Set(week.map(\.groupBy)) == [.day, .model, .agent, .workspace])
        #expect(week.allSatisfy { $0.to == "2026-11-17T00:00:00.000Z" && $0.workspaceId == nil })
        let today = backend.queries.filter { $0.from == "2026-11-16T00:00:00.000Z" }
        #expect(today.map(\.groupBy) == [.workspace])
        #expect(today.first?.to == "2026-11-17T00:00:00.000Z")
    }

    @Test func totalsAreTheLedgerWithinThePeriod() throws {
        let totals = try fixture.weekDashboard().totals
        // 2026-11-08's call is before the period.
        #expect(totals.calls == 12)
        #expect(abs(totals.credits - 65.938) < 1e-9)
        #expect(totals.inputTokens == 714_000)
        #expect(totals.cachedInputTokens == 288_000)
        #expect(totals.outputTokens == 32_700)
        #expect(totals.tokens == 746_700)
    }

    @Test func everyDayOfThePeriodHasABarAndDaysWithoutUsageAreZero() throws {
        let days = try fixture.weekDashboard().byDay
        #expect(days.map(\.id) == ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"])
        #expect(days.map(\.credits) == [13.8975, 6.28, 0, 2.5605, 0, 19.78, 23.42])
        #expect(days.first?.label == "Nov 10")
    }

    @Test func breakdownsAreLargestFirstWithWorkspacesByName() throws {
        let dashboard = try fixture.weekDashboard()
        #expect(dashboard.byModel.map(\.label) == ["claude-sonnet", "gpt-mini", "gemini-flash"])
        #expect(dashboard.byAgent.map(\.label) == ["main", "bulk-reader", "code-writer", "repo-scout"])
        #expect(dashboard.byAgent.map(\.calls) == [7, 2, 2, 1])
        #expect(dashboard.byWorkspace?.map(\.label) == ["Payments", "Search", "Mobile"])
        #expect(dashboard.byWorkspace?.map(\.id) == ["ws-1", "ws-2", "ws-3"])
    }

    @Test func theSavingsFigureIsTheEnginesEstimateUnderItsLabel() throws {
        let savings = try fixture.weekDashboard().savings
        #expect(savings.credits == 199.55)
        #expect(savings.title == "Estimated savings")
        #expect(savings.value == "≈ 199.55 credits")
        #expect(savings.accessibilityText.hasPrefix("Estimated savings: about 199.55 credits."))
        #expect(savings.footnote.hasPrefix("An estimate"))
    }

    @Test func aWorkspaceFilterNarrowsEveryRollupAndHidesTheWorkspaceChart() async throws {
        let backend = FakeUsageBackend(fixture: fixture)
        let store = try store(backend)
        store.workspaceId = "ws-1"
        await store.load()
        let week = backend.queries.filter { $0.from == "2026-11-10T00:00:00.000Z" }
        #expect(Set(week.map(\.groupBy)) == [.day, .model, .agent])
        #expect(week.allSatisfy { $0.workspaceId == "ws-1" })
        let dashboard = try #require(store.dashboard)
        #expect(dashboard.byWorkspace == nil)
        #expect(abs(dashboard.totals.credits - 41.3775) < 1e-9)
        #expect(dashboard.byModel.map(\.label) == ["claude-sonnet", "gpt-mini"])
        #expect(dashboard.savings.credits == 112.9425)
    }

    @Test(arguments: [
        (3000.0, nil),
        (25.0, UsageTone.warning),
        (22.0, UsageTone.danger),
        (20.0, UsageTone.danger),
    ] as [(Credits, UsageTone?)])
    func todaysSpendWarnsFromThreeQuartersOfTheDailyCap(cap: Credits, tone: UsageTone?) throws {
        let warnings = try fixture.weekDashboard(dailyCap: cap).capWarnings
        // Today ws-1 (Payments) spent 21.2 and ws-3 (Mobile) 2.22.
        #expect(warnings.map(\.tone) == (tone.map { [$0] } ?? []))
        #expect(warnings.map(\.workspaceName) == (tone == nil ? [] : ["Payments"]))
    }

    @Test func aReachedCapSaysNewSessionsAreBlockedUntilMidnightUTC() throws {
        let warning = try #require(try fixture.weekDashboard(dailyCap: 20).capWarnings.first)
        #expect(warning.reached)
        #expect(warning.message == "Payments has used 21.2 of its 20 daily credits. New sessions are blocked until 00:00 UTC.")
        let near = try #require(try fixture.weekDashboard(dailyCap: 25).capWarnings.first)
        #expect(!near.reached)
        #expect(near.message == "Payments has used 21.2 of its 25 daily credits (85%).")
    }

    @Test func capWarningsFollowTheWorkspaceFilterButNotThePeriod() throws {
        let all = try fixture.weekDashboard(workspaceId: nil, dailyCap: 2.5).capWarnings
        #expect(all.map(\.workspaceName) == ["Payments", "Mobile"])
        let filtered = UsageDashboard(
            try fixture.weekRollups(), period: .last7Days, now: try fixture.date, workspaceId: "ws-3",
            names: fixture.names, dailyCap: 2.5)
        #expect(filtered.capWarnings.map(\.workspaceName) == ["Mobile"])
    }

    @Test func noCapMeansNoWarnings() throws {
        #expect(try fixture.weekDashboard(dailyCap: nil).capWarnings.isEmpty)
    }

    @Test func moreThanEightRowsEndInAnOtherBar() {
        let rows = (1...10).map {
            UsageRollupRow(key: "model-\($0)", calls: 1, inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, credits: Double($0))
        }
        let bars = UsageBar.ranked(rows, label: { $0 })
        #expect(bars.count == 8)
        #expect(bars.prefix(7).map(\.id) == (4...10).reversed().map { "model-\($0)" })
        #expect(bars.last == UsageBar(id: UsageBar.otherId, label: "Other", credits: 6, calls: 3, tokens: 330))
        #expect(UsageBar.ranked(Array(rows.prefix(8)), label: { $0 }).count == 8)
    }

    @Test func aFailedLoadShowsTheErrorAndKeepsTheFilters() async throws {
        let backend = FakeUsageBackend(fixture: fixture)
        backend.failure = .engine(RpcError(code: -32603, message: "the ledger is busy"))
        let store = try store(backend)
        store.period = .last30Days
        await store.load()
        #expect(store.failure == "the ledger is busy")
        #expect(store.dashboard == nil)
        #expect(store.period == .last30Days)
    }

    @Test func periodsAreWholeUTCDays() throws {
        let now = try Date("2026-11-16T23:59:00-05:00", strategy: .iso8601)
        #expect(UsagePeriod.today.bounds(now: now) == ("2026-11-17T00:00:00.000Z", "2026-11-18T00:00:00.000Z"))
        #expect(UsagePeriod.last30Days.bounds(now: now).from == "2026-10-19T00:00:00.000Z")
        #expect(UsagePeriod.last30Days.dayKeys(now: now).count == 30)
    }
}
