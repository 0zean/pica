import DesignSystem
import SwiftUI

/// The dashboard's content for one load: totals, the savings estimate, budget warnings and the charts (docs/usage.md).
public struct UsageDashboardView: View {
    let dashboard: UsageDashboard

    public init(dashboard: UsageDashboard) {
        self.dashboard = dashboard
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Spacing.large) {
            HStack(alignment: .top, spacing: Spacing.medium) {
                TotalTile(
                    title: "Credits", value: UsageFormat.credits(dashboard.totals.credits),
                    caption: dashboard.period.title, identifier: "pica.usage.total.credits")
                TotalTile(
                    title: "Tokens", value: UsageFormat.tokens(dashboard.totals.tokens),
                    caption: "\(UsageFormat.tokens(dashboard.totals.cachedInputTokens)) cached input",
                    identifier: "pica.usage.total.tokens")
                TotalTile(
                    title: "Model calls", value: dashboard.totals.calls.formatted(), caption: "Across every agent",
                    identifier: "pica.usage.total.calls")
                SavingsTile(savings: dashboard.savings)
            }
            .fixedSize(horizontal: false, vertical: true)
            ForEach(dashboard.capWarnings) { warning in
                CapWarningRow(warning: warning)
            }
            Card {
                VStack(alignment: .leading, spacing: Spacing.small) {
                    Text("Credits by day")
                        .font(Typography.headline)
                        .foregroundStyle(Palette.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Text("UTC days")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecondary)
                    DayChart(bars: dashboard.byDay)
                }
            }
            HStack(alignment: .top, spacing: Spacing.medium) {
                Card { BreakdownChart(title: "By model", bars: dashboard.byModel, identifier: "pica.usage.chart.model") }
                Card { BreakdownChart(title: "By agent", bars: dashboard.byAgent, identifier: "pica.usage.chart.agent") }
            }
            if let byWorkspace = dashboard.byWorkspace {
                Card {
                    BreakdownChart(title: "By workspace", bars: byWorkspace, identifier: "pica.usage.chart.workspace")
                }
            }
        }
        .padding(Spacing.xLarge)
    }
}

private struct TotalTile: View {
    let title: String
    let value: String
    let caption: String
    let identifier: String

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.xSmall) {
                Text(title)
                    .font(Typography.caption.weight(.medium))
                    .foregroundStyle(Palette.textSecondary)
                Text(value)
                    .font(Typography.title)
                    .foregroundStyle(Palette.textPrimary)
                    .monospacedDigit()
                Text(caption)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
            .frame(maxHeight: .infinity, alignment: .topLeading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title): \(value), \(caption)")
        .accessibilityIdentifier(identifier)
    }
}

/// The savings estimate, always under its "Estimated savings" title and with how it is estimated.
struct SavingsTile: View {
    let savings: SavingsFigure

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.xSmall) {
                Text(savings.title)
                    .font(Typography.caption.weight(.medium))
                    .foregroundStyle(Palette.textSecondary)
                Text(savings.value)
                    .font(Typography.title)
                    .foregroundStyle(Palette.success)
                    .monospacedDigit()
                Text(savings.footnote)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxHeight: .infinity, alignment: .topLeading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(savings.accessibilityText)
        .accessibilityIdentifier("pica.usage.savings")
    }
}

private struct CapWarningRow: View {
    let warning: DailyCapWarning

    var body: some View {
        Label(warning.message, systemImage: warning.reached ? "xmark.octagon" : "exclamationmark.triangle")
            .font(Typography.callout)
            .foregroundStyle(warning.tone.color)
            .padding(.horizontal, Spacing.medium)
            .padding(.vertical, Spacing.small)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Radius.medium, style: .continuous).fill(Palette.surface))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.medium, style: .continuous)
                    .strokeBorder(warning.tone.color.opacity(0.6), lineWidth: 1))
            .accessibilityIdentifier("pica.usage.capWarning.\(warning.id)")
    }
}
