import DesignSystem
import PicaProtocol
import SwiftUI

/// Every file of the kind, grouped by name with the winning one first; each row names its source and its status.
struct ItemList: View {
    @Bindable var store: CustomizationStore

    var body: some View {
        List(selection: $store.selectedPath) {
            ForEach(store.items, id: \.path) { item in
                ItemRow(item: item, presentation: store.presentation(of: item)).tag(item.path)
            }
        }
        .listStyle(.inset)
        .accessibilityIdentifier("pica.customization.list")
    }
}

struct ItemRow: View {
    let item: CustomizationItem
    let presentation: ItemPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxSmall) {
            HStack(spacing: Spacing.xSmall) {
                Text(item.name).font(Typography.headline)
                    .foregroundStyle(presentation.tone == .overridden ? Palette.textSecondary : Palette.textPrimary)
                if presentation.lock != nil {
                    Image(systemName: "lock.fill").font(Typography.caption).foregroundStyle(Palette.textSecondary)
                        .accessibilityHidden(true)
                }
                Spacer()
                Chip(presentation.status, tone: presentation.tone.chipTone)
            }
            Text(presentation.source).font(Typography.caption).foregroundStyle(Palette.textSecondary)
            if let description = item.description {
                Text(description).font(Typography.caption).foregroundStyle(Palette.textSecondary).lineLimit(1)
            }
        }
        .padding(.vertical, Spacing.xxSmall)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.name), \(presentation.source), \(presentation.status)")
        .accessibilityIdentifier("pica.customization.row.\(item.locationId).\(item.name)")
    }
}

extension ItemPresentation.Tone {
    var chipTone: Chip.Tone {
        switch self {
        case .winning: .success
        case .applying: .accent
        case .overridden: .neutral
        case .invalid: .danger
        }
    }
}
