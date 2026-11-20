@testable import Usage
import Foundation
import PicaProtocol
import Testing

/// PLAN.md A-11: the session chip's figures and its popover's breakdown from the ledger fixture (docs/usage.md).
@MainActor
@Suite struct SessionUsageTests {
    @Test func theChipShowsContextTokensAndCreditsAgainstTheBudget() {
        let figures = SessionUsageFigures(
            inputTokens: 16_000, cachedInputTokens: 9_000, outputTokens: 2_300, credits: 1.2, contextTokens: 54_000,
            contextLimit: 128_000, budgetCredits: 300)
        #expect(figures.text == "Context 42% · 18.3K tokens · 1.2 of 300 credits")
        #expect(figures.compactText == "42%")
        #expect(figures.tone == .neutral)
    }

    @Test func withoutABudgetOrAContextReportTheChipSaysSo() {
        let figures = SessionUsageFigures(inputTokens: 950, credits: 0.25)
        #expect(figures.text == "Context – · 950 tokens · 0.25 credits")
        #expect(figures.compactText == "–")
        #expect(figures.help.hasSuffix("No budget limit"))
    }

    @Test(arguments: [
        (0.0, 100.0, UsageTone.neutral),
        (74.9, 100.0, .neutral),
        (75.0, 100.0, .warning),
        (90.0, 100.0, .danger),
        (130.0, 100.0, .danger),
    ] as [(Credits, Credits, UsageTone)])
    func theBudgetTonesTheChipAtTheWarningThresholds(spent: Credits, limit: Credits, tone: UsageTone) {
        #expect(SessionUsageFigures(credits: spent, budgetCredits: limit).tone == tone)
    }

    @Test func theWorseOfContextAndBudgetSetsTheTone() {
        let nearlyFullContext = SessionUsageFigures(credits: 1, contextTokens: 95, contextLimit: 100, budgetCredits: 300)
        #expect(nearlyFullContext.tone == .danger)
        let budgetWarning = SessionUsageFigures(credits: 240, contextTokens: 10, contextLimit: 100, budgetCredits: 300)
        #expect(budgetWarning.tone == .warning)
    }

    @Test func thePopoverBreaksTheSessionDownByAgentAndModel() async throws {
        let backend = FakeUsageBackend(fixture: try LedgerFixture.load())
        let store = SessionUsageStore(sessionId: "s-2", backend: backend)
        await store.load()
        #expect(Set(backend.queries.map(\.groupBy)) == [.agent, .model])
        #expect(backend.queries.allSatisfy { $0.sessionId == "s-2" && $0.from == nil })
        let breakdown = try #require(store.breakdown)
        #expect(breakdown.byAgent.map(\.label) == ["main", "code-writer"])
        #expect(breakdown.byAgent.map(\.credits) == [21.9, 5.58])
        #expect(breakdown.byModel.map(\.label) == ["claude-sonnet", "gpt-mini"])
        #expect(breakdown.savings.credits == 61.38)
        #expect(breakdown.savings.title == "Estimated savings")
    }
}
