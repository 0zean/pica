import Charts
import DesignSystem
import SwiftUI

/// Credits per UTC day of the period. Days are categories with labels made in UTC, so a bar never moves to the next
/// day in the Mac's time zone.
struct DayChart: View {
    let bars: [DayBar]

    var body: some View {
        Chart(bars) { bar in
            BarMark(x: .value("Day", bar.label), y: .value("Credits", bar.credits))
                .foregroundStyle(Palette.accent)
                .cornerRadius(Radius.small)
                .accessibilityLabel(bar.label)
                .accessibilityValue("\(UsageFormat.credits(bar.credits)) credits")
        }
        .chartXAxis {
            AxisMarks { value in
                if let day = value.as(String.self), labeledDays.contains(day) {
                    AxisValueLabel().font(Typography.caption).foregroundStyle(Palette.textSecondary)
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { _ in
                AxisGridLine().foregroundStyle(Palette.border)
                AxisValueLabel().font(Typography.caption).foregroundStyle(Palette.textSecondary)
            }
        }
        .frame(height: 160)
        .accessibilityIdentifier("pica.usage.chart.day")
    }

    /// Every day for a week or less; every fifth day, ending today, for longer periods.
    private var labeledDays: Set<String> {
        guard bars.count > 7 else { return Set(bars.map(\.label)) }
        let last = bars.count - 1
        return Set(bars.indices.filter { (last - $0) % 5 == 0 }.map { bars[$0].label })
    }
}

/// Credits per model, agent or workspace as horizontal bars, largest first, each annotated with its calls and tokens.
struct BreakdownChart: View {
    let title: String
    let bars: [UsageBar]
    let identifier: String
    /// In the chip's popover: annotations without tokens, and more room for them.
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            Text(title)
                .font(Typography.headline)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if bars.isEmpty {
                Text("No usage in this period.")
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
            } else {
                chart
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }

    /// Each bar's name sits over it, so long model names never squeeze the bars.
    private var chart: some View {
        Chart(bars) { bar in
            BarMark(x: .value("Credits", bar.credits), y: .value("Name", bar.id), height: .fixed(12))
                .foregroundStyle(bar.id == UsageBar.otherId ? Palette.ring : Palette.accent)
                .cornerRadius(Radius.small)
                .annotation(position: .top, alignment: .leading, spacing: Spacing.xxSmall) {
                    Text(bar.label)
                        .font(Typography.callout)
                        .foregroundStyle(Palette.textPrimary)
                        .fixedSize()
                }
                .annotation(position: .trailing, alignment: .leading) {
                    Text(annotation(bar))
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecondary)
                        .fixedSize()
                }
                .accessibilityLabel(bar.label)
                .accessibilityValue(annotation(bar))
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartXScale(domain: 0...(maxCredits * (compact ? 2.2 : 1.6)))
        .frame(height: CGFloat(bars.count) * 38)
    }

    /// Room on the right for the annotations.
    private var maxCredits: Double {
        max(bars.map(\.credits).max() ?? 0, 0.01)
    }

    private func annotation(_ bar: UsageBar) -> String {
        let figures = "\(UsageFormat.credits(bar.credits)) cr · \(UsageFormat.calls(bar.calls))"
        return compact ? figures : "\(figures) · \(UsageFormat.tokens(bar.tokens)) tokens"
    }
}
