import DesignSystem
import SwiftUI

struct UserMessageRow: View {
    let item: UserMessageItem

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            HStack(spacing: Spacing.small) {
                Text("You")
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.textSecondary)
                switch item.mode {
                case .send: EmptyView()
                case .steer: Chip("Steer", systemImage: "arrow.turn.down.right", tone: .accent)
                case .queue: Chip("Queued", systemImage: "text.line.last.and.arrowtriangle.forward", tone: .neutral)
                }
            }
            Text(item.text)
                .font(Typography.body)
                .foregroundStyle(Palette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.medium)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(shape.fill(Palette.surface))
        .overlay(shape.strokeBorder(Palette.border, lineWidth: 1))
        .copyable(item.text)
    }
}

struct AssistantMessageRow: View {
    let item: AssistantMessageItem

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            if item.agent != "main" {
                Text(item.agent)
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.textSecondary)
            }
            MarkdownView(document: item.document)
            if item.isStreaming {
                ActivityMark(isWorking: true)
                    .frame(width: 16, height: 16)
                    .accessibilityLabel("Writing")
            }
        }
        .padding(.horizontal, Spacing.xSmall)
        .copyable(item.text)
    }
}
