import DesignSystem
import SwiftUI

/// The completion list while there is one, and nothing otherwise. It is a view of its own so the composer can put an
/// alignment guide on it outside the `if`.
struct CompletionPopup: View {
    let store: ComposerStore
    let maxHeight: CGFloat

    var body: some View {
        if let completion = store.completion {
            CompletionList(store: store, completion: completion, maxHeight: maxHeight)
        }
    }
}

/// The completions for the mention or skill being typed, above the input. ↑ and ↓ move, Return or Tab inserts, Escape
/// hides it; a click inserts too. It is as tall as its rows up to `maxHeight`, then scrolls, keeping the selected row
/// in view.
struct CompletionList: View {
    let store: ComposerStore
    let completion: ComposerStore.Completion
    let maxHeight: CGFloat
    @State private var rowsHeight: CGFloat?

    private var selectedId: String? {
        completion.items.indices.contains(completion.selected) ? completion.items[completion.selected].id : nil
    }

    var body: some View {
        let inner = max(maxHeight - 2 * Spacing.xSmall, 0)
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(completion.items.enumerated()), id: \.element.id) { index, item in
                        CompletionRow(item: item, selected: index == completion.selected)
                            .contentShape(Rectangle())
                            .onTapGesture { store.accept(item) }
                            .accessibilityElement(children: .combine)
                            .accessibilityAddTraits(index == completion.selected ? [.isButton, .isSelected] : .isButton)
                            .accessibilityIdentifier("pica.composer.completion.\(item.id)")
                            .id(item.id)
                            .probedFrame(item.id)
                    }
                }
                .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { rowsHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollIndicators((rowsHeight ?? 0) > inner ? .automatic : .hidden)
            .frame(height: min(rowsHeight ?? CompletionRow.estimatedHeight * CGFloat(completion.items.count), inner))
            .onChange(of: selectedId, initial: true) {
                // With no anchor, scrolls the least that brings the row into view.
                if let selectedId { proxy.scrollTo(selectedId) }
            }
        }
        .padding(Spacing.xSmall)
        .frame(minWidth: 240, maxWidth: 420, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Radius.medium, style: .continuous).fill(Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: Radius.medium, style: .continuous).stroke(Palette.border))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
        .probedFrame("list")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.composer.completions")
    }
}

private struct CompletionRow: View {
    /// Until the rows are measured.
    static let estimatedHeight: CGFloat = 24

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
