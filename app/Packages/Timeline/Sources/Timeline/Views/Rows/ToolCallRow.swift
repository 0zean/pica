import DesignSystem
import SwiftUI

/// A tool call as one compact line; clicking it shows the arguments, the result and the policy decision.
struct ToolCallRow: View {
    @Bindable var item: ToolCallItem

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            Button {
                item.isExpanded.toggle()
            } label: {
                summary
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("pica.timeline.tool.\(item.toolCallId)")
            .accessibilityValue(item.isExpanded ? "expanded" : "collapsed")
            if item.isExpanded {
                details.padding(.leading, Spacing.xLarge)
            }
        }
        .padding(.horizontal, Spacing.xSmall)
    }

    private var summary: some View {
        HStack(spacing: Spacing.small) {
            DisclosureChevron(isExpanded: item.isExpanded)
            statusIcon.frame(width: 14)
            Text(item.toolName)
                .font(Typography.code)
                .foregroundStyle(Palette.textPrimary)
            Text(Format.argumentSummary(item.arguments))
                .font(Typography.callout)
                .foregroundStyle(Palette.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: Spacing.small)
            if case .completed(_, let bytes, _) = item.status {
                Text(Format.bytes(bytes))
                    .font(Typography.caption.monospacedDigit())
                    .foregroundStyle(Palette.textSecondary)
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder private var statusIcon: some View {
        switch item.status {
        case .running:
            ActivityMark(isWorking: true).frame(width: 14, height: 14).accessibilityLabel("Running")
        case .completed:
            Image(systemName: "checkmark").foregroundStyle(Palette.success).accessibilityLabel("Completed")
        case .failed:
            Image(systemName: "xmark").foregroundStyle(Palette.danger).accessibilityLabel("Failed")
        }
    }

    @ViewBuilder private var details: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            if !item.arguments.isEmpty {
                Text("Arguments").font(Typography.caption.weight(.semibold)).foregroundStyle(Palette.textSecondary)
                CodeBox(text: Format.json(.object(item.arguments)))
            }
            switch item.status {
            case .running:
                EmptyView()
            case .completed(let preview, _, let spilledPath):
                Text("Result").font(Typography.caption.weight(.semibold)).foregroundStyle(Palette.textSecondary)
                CodeBox(text: preview.isEmpty ? "(empty)" : preview)
                if let spilledPath {
                    Text("Full output: \(spilledPath)")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecondary)
                }
            case .failed(let error):
                Text(error)
                    .font(Typography.callout)
                    .foregroundStyle(Palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let decision = item.decision {
                Text("\(PolicyPresentation(decision.outcome).verb) by \(decision.ruleId): \(decision.reason)")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
