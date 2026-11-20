import DesignSystem
import SwiftUI

/// The session's breakdown under its chip: tokens, credits against the budget, credits by agent and model, and the
/// savings estimate.
struct SessionUsagePopover: View {
    let figures: SessionUsageFigures
    @State var store: SessionUsageStore
    let openDashboard: () -> Void

    var body: some View {
        SessionUsageDetail(figures: figures, breakdown: store.breakdown, failure: store.failure, openDashboard: openDashboard)
            .task { await store.load() }
    }
}

/// The popover's content, apart from loading it, so the snapshot tests can draw it.
struct SessionUsageDetail: View {
    let figures: SessionUsageFigures
    let breakdown: SessionUsageBreakdown?
    let failure: String?
    let openDashboard: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text("Session usage")
                .font(Typography.headline)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            tokens
            budget
            Divider().overlay(Palette.border)
            if let breakdown {
                BreakdownChart(title: "By agent", bars: breakdown.byAgent, identifier: "pica.usage.session.agent", compact: true)
                BreakdownChart(title: "By model", bars: breakdown.byModel, identifier: "pica.usage.session.model", compact: true)
                SavingsTile(savings: breakdown.savings)
            } else if let failure {
                Label(failure, systemImage: "exclamationmark.triangle")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.danger)
            } else {
                ProgressView().controlSize(.small)
            }
            Button("Open Usage Dashboard", action: openDashboard)
                .buttonStyle(PicaButtonStyle(.secondary))
                .accessibilityIdentifier("pica.usage.openDashboard")
        }
        .padding(Spacing.large)
        .frame(width: 380)
        .background(Palette.background)
    }

    private var tokens: some View {
        Grid(alignment: .leading, horizontalSpacing: Spacing.large, verticalSpacing: Spacing.xSmall) {
            row("Input", "\(figures.inputTokens.formatted()) tokens (\(figures.cachedInputTokens.formatted()) cached)")
            row("Output", "\(figures.outputTokens.formatted()) tokens")
            row("Context", contextText)
        }
        .font(Typography.callout)
    }

    private var contextText: String {
        guard let tokens = figures.contextTokens, let limit = figures.contextLimit, let fraction = figures.contextFraction
        else { return "Not reported yet" }
        return "\(tokens.formatted()) of \(limit.formatted()) tokens (\(UsageFormat.percent(fraction)))"
    }

    private func row(_ title: String, _ value: String) -> some View {
        GridRow {
            Text(title).foregroundStyle(Palette.textSecondary)
            Text(value).foregroundStyle(Palette.textPrimary).monospacedDigit()
        }
    }

    @ViewBuilder private var budget: some View {
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            Text(figures.budgetCredits == nil ? "\(figures.creditsText) · no budget limit" : figures.creditsText)
                .font(Typography.callout)
                .foregroundStyle(Palette.textPrimary)
                .monospacedDigit()
            if let fraction = figures.budgetFraction {
                BudgetBar(fraction: fraction)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("pica.usage.session.budget")
    }
}

/// Credits spent against the budget, toned at the warning thresholds.
private struct BudgetBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.border)
                Capsule()
                    .fill(UsageTone(fraction: fraction).color)
                    .frame(width: geometry.size.width * min(fraction, 1))
            }
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityLabel("Budget used")
        .accessibilityValue(UsageFormat.percent(fraction))
    }
}
