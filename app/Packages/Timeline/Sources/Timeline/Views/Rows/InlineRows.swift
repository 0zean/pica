import DesignSystem
import PicaProtocol
import SwiftUI

/// How a policy outcome is worded and colored.
struct PolicyPresentation {
    let verb: String
    let systemImage: String
    let color: PicaColor

    init(_ outcome: PolicyOutcome) {
        switch outcome {
        case .allow: (verb, systemImage, color) = ("Allowed", "checkmark.shield", Palette.success)
        case .deny: (verb, systemImage, color) = ("Denied", "xmark.shield", Palette.danger)
        case .ask: (verb, systemImage, color) = ("Needs approval", "questionmark.diamond", Palette.warning)
        case .rewrite: (verb, systemImage, color) = ("Rewritten", "scissors", Palette.accent)
        }
    }
}

struct PolicyRow: View {
    let item: PolicyItem

    var body: some View {
        let decision = item.decision
        let presentation = PolicyPresentation(decision.outcome)
        HStack(alignment: .firstTextBaseline, spacing: Spacing.small) {
            Image(systemName: presentation.systemImage)
                .foregroundStyle(presentation.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                Text("\(presentation.verb) \(Text(decision.toolName).font(Typography.code))")
                    .font(Typography.callout.weight(.semibold))
                    .foregroundStyle(presentation.color)
                Text(decision.reason)
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(decision.ruleId)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
        }
        .padding(.horizontal, Spacing.xSmall)
        .accessibilityElement(children: .combine)
    }
}

struct NoticeRow: View {
    @Bindable var item: NoticeItem

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            if item.raw != nil {
                Button {
                    item.isExpanded.toggle()
                } label: {
                    line
                }
                .buttonStyle(.plain)
                .accessibilityValue(item.isExpanded ? "expanded" : "collapsed")
            } else {
                line
            }
            if item.isExpanded, let raw = item.raw {
                CodeBox(text: raw).padding(.leading, Spacing.xLarge)
            }
        }
        .padding(.horizontal, Spacing.xSmall)
    }

    private var line: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.small) {
            if item.raw != nil {
                DisclosureChevron(isExpanded: item.isExpanded)
            }
            Image(systemName: item.systemImage)
                .foregroundStyle(item.tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                Text(item.title)
                    .font(Typography.callout.weight(.medium))
                    .foregroundStyle(item.tone == .neutral ? Palette.textPrimary : item.tone.color)
                    .fixedSize(horizontal: false, vertical: true)
                if let caption = item.caption {
                    Text(caption)
                        .font(Typography.code)
                        .foregroundStyle(Palette.textSecondary)
                }
            }
        }
        .contentShape(Rectangle())
    }
}
