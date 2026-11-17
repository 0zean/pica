import DesignSystem
import SwiftUI

/// A sub-agent's run, collapsed to its agent, model, duration and tokens; expanding it shows the rows it produced.
struct SubagentGroupRow: View {
    @Bindable var item: SubagentItem

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
        VStack(alignment: .leading, spacing: Spacing.small) {
            Button {
                item.isExpanded.toggle()
            } label: {
                summary
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("pica.timeline.subagent.\(item.toolCallId)")
            .accessibilityValue(item.isExpanded ? "expanded" : "collapsed")
            if item.isExpanded {
                VStack(alignment: .leading, spacing: Spacing.small) {
                    ForEach(item.children) { child in
                        TimelineRow(entry: child)
                    }
                    if case .failed(let error) = item.status {
                        Text(error)
                            .font(Typography.callout)
                            .foregroundStyle(Palette.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.leading, Spacing.large)
            }
        }
        .padding(Spacing.small)
        .background(shape.fill(Palette.surface))
        .overlay(shape.strokeBorder(Palette.border, lineWidth: 1))
    }

    private var summary: some View {
        HStack(spacing: Spacing.small) {
            DisclosureChevron(isExpanded: item.isExpanded)
            ActivityMark(isWorking: item.status == .running)
                .frame(width: 16, height: 16)
                .accessibilityHidden(true)
            Text(item.agent)
                .font(Typography.headline)
                .foregroundStyle(Palette.textPrimary)
            if !item.model.isEmpty {
                Chip(item.model, tone: item.requestedModel == nil ? .neutral : .warning)
                    .help(item.requestedModel.map { "Requested \($0)" } ?? "")
            }
            Spacer(minLength: Spacing.small)
            Text(statusText)
                .font(Typography.caption.monospacedDigit())
                .foregroundStyle(item.status.isFailure ? Palette.danger : Palette.textSecondary)
        }
        .contentShape(Rectangle())
    }

    private var statusText: String {
        switch item.status {
        case .running: "Running · \(item.children.count) \(item.children.count == 1 ? "step" : "steps")"
        case .completed(let tokens, let duration):
            "\(Format.duration(milliseconds: duration)) · \(Format.tokens(tokens)) tokens"
        case .failed: "Failed"
        }
    }
}

extension SubagentItem.Status {
    var isFailure: Bool {
        if case .failed = self { return true }
        return false
    }
}
