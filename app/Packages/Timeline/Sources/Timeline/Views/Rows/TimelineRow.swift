import AppKit
import DesignSystem
import SwiftUI

/// One timeline row, in the list and inside a sub-agent's group.
struct TimelineRow: View {
    let entry: TimelineEntry

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("pica.timeline.row.\(entry.id)")
    }

    @ViewBuilder private var content: some View {
        switch entry {
        case .user(let item): UserMessageRow(item: item)
        case .assistant(let item): AssistantMessageRow(item: item)
        case .tool(let item): ToolCallRow(item: item)
        case .subagent(let item): SubagentGroupRow(item: item)
        case .policy(let item): PolicyRow(item: item)
        case .approval(let item): ApprovalRow(item: item)
        case .notice(let item): NoticeRow(item: item)
        }
    }
}

extension View {
    /// Copy for a row's text. Rows are not selectable: selectable text makes building a row several times slower,
    /// which shows as hitches while scrolling (docs/session-timeline.md). Expanded details, built rarely, are.
    func copyable(_ text: String) -> some View {
        contextMenu {
            Button("Copy") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
        }
    }
}

/// The chevron of a row that expands on click.
struct DisclosureChevron: View {
    let isExpanded: Bool

    var body: some View {
        Image(systemName: "chevron.right")
            .font(Typography.caption.weight(.semibold))
            .foregroundStyle(Palette.textSecondary)
            .rotationEffect(.degrees(isExpanded ? 90 : 0))
            .accessibilityHidden(true)
    }
}

/// Monospaced text in a bordered box, for arguments, results and raw events.
struct CodeBox: View {
    let text: String

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
        Text(text)
            .font(Typography.code)
            .foregroundStyle(Palette.textPrimary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .padding(Spacing.small)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(Palette.background))
            .overlay(shape.strokeBorder(Palette.border, lineWidth: 1))
    }
}

extension NoticeItem.Tone {
    var color: PicaColor {
        switch self {
        case .neutral: Palette.textSecondary
        case .warning: Palette.warning
        case .danger: Palette.danger
        }
    }
}
