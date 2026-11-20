import AppKit
import DesignSystem
import DesignSystemTestSupport
import Foundation
import PicaProtocol
import SwiftUI
import Testing
import Vision
@testable import Usage

/// PLAN.md A-11: the dashboard's charts from the ledger fixture, the session chip in each tone and its popover. Each
/// drawing that holds the savings figure is also read back to check it is labeled as an estimate (docs/usage.md).
@MainActor
@Suite struct UsageSnapshotTests {
    private let location = SnapshotLocation(testFile: #filePath)
    private let fixture: LedgerFixture

    init() throws {
        fixture = try LedgerFixture.load()
    }

    @Test(arguments: [Appearance.light, .dark, .lightIncreasedContrast, .darkIncreasedContrast])
    func theDashboardMatchesReferenceInEachAppearance(_ appearance: Appearance) throws {
        // A cap of 25 puts Payments' 21.2 credits today over the warning threshold.
        let view = UsageDashboardView(dashboard: try fixture.weekDashboard(dailyCap: 25))
        try Self.expectSavingsLabeledAsEstimate(in: view)
        Snapshot.assertMatchesReference(
            Snapshot.render(view, width: 960, appearance: appearance),
            named: "dashboard-week-\(appearance.snapshotName)", in: location)
    }

    @Test func oneWorkspacesDashboardMatchesReference() throws {
        let view = UsageDashboardView(dashboard: try fixture.weekDashboard(workspaceId: "ws-1", dailyCap: 20))
        try Self.expectSavingsLabeledAsEstimate(in: view)
        Snapshot.assertMatchesReference(
            Snapshot.render(view, width: 960, appearance: .light), named: "dashboard-week-ws-1", in: location)
    }

    @Test func thirtyDaysMatchesReference() throws {
        let dashboard = UsageDashboard(
            try fixture.weekRollups(), period: .last30Days, now: try fixture.date, workspaceId: nil, names: fixture.names,
            dailyCap: nil)
        Snapshot.assertMatchesReference(
            Snapshot.render(DayChart(bars: dashboard.byDay).padding(), width: 720, appearance: .light),
            named: "day-chart-30-days", in: location)
    }

    @Test func theChipMatchesReferenceInEachTone() {
        let chips = VStack(alignment: .leading, spacing: 8) {
            ForEach(Self.chipStates, id: \.0) { _, figures in
                SessionUsageChipLabel(figures: figures)
            }
        }
        .padding()
        Snapshot.assertMatchesReference(Snapshot.render(chips, width: 420, appearance: .light), named: "chip-tones", in: location)
        Snapshot.assertMatchesReference(Snapshot.render(chips, width: 420, appearance: .dark), named: "chip-tones-dark", in: location)
    }

    @Test func aNarrowColumnShowsContextUseAlone() {
        let chip = SessionUsageChipLabel(figures: Self.chipStates[1].1).frame(width: 120).padding()
        Snapshot.assertMatchesReference(Snapshot.render(chip, width: 160, appearance: .light), named: "chip-narrow", in: location)
    }

    @Test func thePopoverMatchesReference() throws {
        let breakdown = SessionUsageBreakdown(
            byAgent: try fixture.rollup("session.s-2.agent"), byModel: try fixture.rollup("session.s-2.model"))
        let figures = SessionUsageFigures(
            inputTokens: 168_000, cachedInputTokens: 122_000, outputTokens: 23_200, credits: 27.48, contextTokens: 61_000,
            contextLimit: 128_000, budgetCredits: 35)
        let view = SessionUsageDetail(figures: figures, breakdown: breakdown, failure: nil, openDashboard: {})
        try Self.expectSavingsLabeledAsEstimate(in: view)
        Snapshot.assertMatchesReference(Snapshot.render(view, width: 380, appearance: .light), named: "popover", in: location)
    }

    static let chipStates: [(String, SessionUsageFigures)] = [
        ("no-context", SessionUsageFigures(inputTokens: 950, outputTokens: 40, credits: 0.25)),
        ("neutral", SessionUsageFigures(
            inputTokens: 16_000, cachedInputTokens: 9_000, outputTokens: 2_300, credits: 1.2, contextTokens: 54_000,
            contextLimit: 128_000, budgetCredits: 300)),
        ("budget-warning", SessionUsageFigures(
            inputTokens: 480_000, outputTokens: 31_000, credits: 240, contextTokens: 40_000, contextLimit: 128_000,
            budgetCredits: 300)),
        ("context-danger", SessionUsageFigures(
            inputTokens: 900_000, outputTokens: 52_000, credits: 64, contextTokens: 121_000, contextLimit: 128_000,
            budgetCredits: 300)),
    ]

    /// Reads the drawing's text with Vision: wherever "savings" appears, it is in "Estimated savings".
    static func expectSavingsLabeledAsEstimate(in view: some View, sourceLocation: SourceLocation = #_sourceLocation) throws {
        let renderer = ImageRenderer(content: view.frame(width: 960).background(Palette.background))
        renderer.scale = 2
        let image = try #require(renderer.cgImage, sourceLocation: sourceLocation)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: image).perform([request])
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        let savings = lines.filter { $0.localizedCaseInsensitiveContains("savings") }
        #expect(!savings.isEmpty, "no savings figure among \(lines)", sourceLocation: sourceLocation)
        #expect(savings.allSatisfy { $0.contains("Estimated savings") }, "\(savings)", sourceLocation: sourceLocation)
    }
}
