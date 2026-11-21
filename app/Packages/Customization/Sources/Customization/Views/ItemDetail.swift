import DesignSystem
import PicaProtocol
import SwiftUI

/// One file: where it is, why it does or does not apply, and its text, editable when Pica may write it.
struct ItemDetail: View {
    let item: CustomizationItem
    let store: CustomizationStore
    @State private var text: String
    @State private var confirmingDelete = false

    init(item: CustomizationItem, store: CustomizationStore) {
        self.item = item
        self.store = store
        _text = State(initialValue: item.text)
    }

    var body: some View {
        let presentation = store.presentation(of: item)
        let editable = store.isEditable(item)
        VStack(alignment: .leading, spacing: Spacing.small) {
            HStack(spacing: Spacing.small) {
                Text(item.name).font(Typography.title)
                Chip(presentation.status, tone: presentation.tone.chipTone)
                    .accessibilityIdentifier("pica.customization.detail.status")
                Spacer()
            }
            Text(presentation.source).font(Typography.callout).foregroundStyle(Palette.textSecondary)
                .accessibilityIdentifier("pica.customization.detail.source")
            Text(item.path).font(Typography.caption).foregroundStyle(Palette.textSecondary).textSelection(.enabled)
                .lineLimit(2)
            if let lock = presentation.lock {
                Label(lock, systemImage: "lock.fill").font(Typography.callout).foregroundStyle(Palette.textSecondary)
                    .accessibilityIdentifier("pica.customization.lock")
            } else if !item.writable {
                Text("Built into Pica. Create an agent of the same name in another layer to override it.")
                    .font(Typography.callout).foregroundStyle(Palette.textSecondary)
            }
            ForEach(Array(item.problems.enumerated()), id: \.offset) { _, problem in
                Label(problem.field.isEmpty ? problem.message : "\(problem.field): \(problem.message)",
                      systemImage: "exclamationmark.circle")
                    .font(Typography.callout).foregroundStyle(Palette.danger)
            }
            TextEditor(text: $text)
                .font(Typography.code)
                .disabled(!editable)
                .scrollContentBackground(.hidden)
                .padding(Spacing.xSmall)
                .background(Palette.surface)
                .clipShape(RoundedRectangle(cornerRadius: Radius.medium))
                .accessibilityIdentifier("pica.customization.editor")
            HStack {
                Button("Delete…", role: .destructive) { confirmingDelete = true }
                    .disabled(!editable)
                    .accessibilityIdentifier("pica.customization.delete")
                Spacer()
                Button("Revert") { text = item.text }
                    .disabled(text == item.text)
                Button("Save") { Task { await store.save(item, text: text) } }
                    .keyboardShortcut("s", modifiers: .command)
                    .disabled(!editable || text == item.text)
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("pica.customization.save")
            }
        }
        .padding(Spacing.medium)
        .confirmationDialog("Delete \(item.name)?", isPresented: $confirmingDelete) {
            Button("Delete", role: .destructive) { Task { await store.delete(item) } }
        } message: {
            Text("\(item.path) is removed from disk.")
        }
    }
}
