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

/// An approval request inline in the timeline; A-07 adds the choices.
struct ApprovalRow: View {
    let item: ApprovalItem

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
        HStack(alignment: .firstTextBaseline, spacing: Spacing.small) {
            Image(systemName: icon)
                .foregroundStyle(item.choice == nil ? Palette.warning : Palette.textSecondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                Text(item.summary)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(status)
                    .font(Typography.caption.weight(.medium))
                    .foregroundStyle(statusColor)
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.medium)
        .background(shape.fill(Palette.surface))
        .overlay(shape.strokeBorder(item.choice == nil ? Palette.warning : Palette.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch item.kind {
        case .toolCall: "hand.raised"
        case .budget: "creditcard"
        }
    }

    private var status: String {
        switch item.choice {
        case nil: "Waiting for your approval"
        case .allowOnce: "Allowed once"
        case .allowAlways: "Always allowed"
        case .deny: "Denied"
        }
    }

    private var statusColor: PicaColor {
        switch item.choice {
        case nil: Palette.warning
        case .allowOnce, .allowAlways: Palette.success
        case .deny: Palette.danger
        }
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
