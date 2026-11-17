import DesignSystem
import SwiftUI

/// The bar over the timeline: the session's title, and its context use, tokens and credits.
struct TimelineHeader: View {
    let store: TimelineStore
    let title: String

    var body: some View {
        HStack(spacing: Spacing.small) {
            Text(title)
                .font(Typography.headline)
                .foregroundStyle(Palette.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("pica.session.title")
            if let failure = store.failure {
                Label(failure, systemImage: "exclamationmark.triangle")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.danger)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 0)
            UsageChip(usage: store.usage)
        }
        .padding(.horizontal, Spacing.large)
        .padding(.vertical, Spacing.small)
        .background(Palette.background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Palette.border).frame(height: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.timeline.header")
    }
}

/// Context use, tokens and credits in one chip; in a narrow column, context use alone, or nothing, so the chip never
/// sets the column's minimum width.
struct UsageChip: View {
    let usage: SessionUsageSummary

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Chip(Self.text(usage), systemImage: "gauge.with.dots.needle.33percent", tone: tone)
            Chip(Self.compactText(usage), systemImage: "gauge.with.dots.needle.33percent", tone: tone)
            Color.clear.frame(width: 0, height: 0)
        }
        .help(Self.help(usage))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Self.text(usage))
        .accessibilityIdentifier("pica.timeline.usage")
    }

    static func compactText(_ usage: SessionUsageSummary) -> String {
        usage.contextFraction.map { Format.percent($0) } ?? "–"
    }

    private var tone: Chip.Tone {
        guard let fraction = usage.contextFraction else { return .neutral }
        return fraction >= 0.9 ? .danger : fraction >= 0.75 ? .warning : .neutral
    }

    static func text(_ usage: SessionUsageSummary) -> String {
        let context = usage.contextFraction.map { "Context \(Format.percent($0))" } ?? "Context –"
        return "\(context) · \(Format.tokens(usage.totalTokens)) tokens · \(Format.credits(usage.credits)) credits"
    }

    static func help(_ usage: SessionUsageSummary) -> String {
        var lines = [
            "Input \(usage.inputTokens.formatted()) tokens (\(usage.cachedInputTokens.formatted()) cached)",
            "Output \(usage.outputTokens.formatted()) tokens",
        ]
        if let tokens = usage.contextTokens, let limit = usage.contextLimit {
            lines.append("Context \(tokens.formatted()) of \(limit.formatted()) tokens")
        }
        return lines.joined(separator: "\n")
    }
}
