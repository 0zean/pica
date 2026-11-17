import DesignSystem
import SwiftUI

/// The completions for the mention or skill being typed, over the input. ↑ and ↓ move, Return or Tab inserts, Escape
/// hides it; a click inserts too.
struct CompletionList: View {
    let store: ComposerStore
    let completion: ComposerStore.Completion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(completion.items.enumerated()), id: \.element.id) { index, item in
                CompletionRow(item: item, selected: index == completion.selected)
                    .contentShape(Rectangle())
                    .onTapGesture { store.accept(item) }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(index == completion.selected ? [.isButton, .isSelected] : .isButton)
                    .accessibilityIdentifier("pica.composer.completion.\(item.id)")
            }
        }
        .padding(Spacing.xSmall)
        .frame(minWidth: 240, maxWidth: 420, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Radius.medium, style: .continuous).fill(Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: Radius.medium, style: .continuous).stroke(Palette.border))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.composer.completions")
    }
}

private struct CompletionRow: View {
    let item: CompletionItem
    let selected: Bool

    var body: some View {
        HStack(spacing: Spacing.small) {
            Image(systemName: symbol)
                .frame(width: 16)
                .foregroundStyle(selected ? Palette.onAccent : Palette.textSecondary)
                .accessibilityHidden(true)
            Text(item.kind == .skill ? "/\(item.name)" : item.name)
                .font(Typography.body)
                .foregroundStyle(selected ? Palette.onAccent : Palette.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: Spacing.small)
            Text(item.detail)
                .font(Typography.caption)
                .foregroundStyle(selected ? Palette.onAccent : Palette.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, Spacing.small)
        .padding(.vertical, Spacing.xSmall)
        .background(
            RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                .fill(selected ? AnyShapeStyle(Palette.accent) : AnyShapeStyle(Color.clear)))
    }

    private var symbol: String {
        switch item.kind {
        case .repo: "shippingbox"
        case .file: "doc.text"
        case .agent: "person.crop.circle"
        case .skill: "wand.and.stars"
        }
    }
}
