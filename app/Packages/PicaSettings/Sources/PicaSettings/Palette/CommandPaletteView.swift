import DesignSystem
import SwiftUI

/// The ⌘K palette: a field and the rows that match it. ↑ and ↓ move, ↩ runs, ⎋ closes.
public struct CommandPaletteView: View {
    @Bindable private var model: CommandPaletteModel
    private let registry: ActionRegistry
    private let keybindings: KeybindingStore
    private let runOther: @MainActor (String) -> Void
    @FocusState private var fieldFocused: Bool

    public init(
        model: CommandPaletteModel, registry: ActionRegistry, keybindings: KeybindingStore,
        runOther: @escaping @MainActor (String) -> Void
    ) {
        self.model = model
        self.registry = registry
        self.keybindings = keybindings
        self.runOther = runOther
    }

    public var body: some View {
        let results = model.results
        VStack(spacing: 0) {
            TextField("Search commands", text: $model.query)
                .textFieldStyle(.plain)
                .font(Typography.title)
                .padding(Spacing.medium)
                .focused($fieldFocused)
                .accessibilityIdentifier("pica.palette.field")
                .onKeyPress(.downArrow) { model.moveSelection(by: 1); return .handled }
                .onKeyPress(.upArrow) { model.moveSelection(by: -1); return .handled }
                .onSubmit { run(model.selected) }
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(results.enumerated()), id: \.element.id) { index, item in
                            row(item, selected: index == model.selectedIndex)
                                .id(item.id)
                        }
                    }
                }
                .onChange(of: model.selectedIndex) { _, index in
                    if results.indices.contains(index) { proxy.scrollTo(results[index].id) }
                }
            }
            .frame(height: 320)
            if results.isEmpty {
                Text("No matching commands")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .padding(Spacing.medium)
            }
        }
        .frame(width: 520)
        .background(Palette.background)
        .onAppear { fieldFocused = true }
        .onExitCommand { model.isPresented = false }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.palette")
    }

    private func row(_ item: PaletteItem, selected: Bool) -> some View {
        Button {
            run(item)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(Typography.body)
                    if let subtitle = item.subtitle {
                        Text(subtitle).font(Typography.caption).foregroundStyle(Palette.textSecondary)
                    }
                }
                Spacer()
                if case .action(let id) = item.target, let shortcut = keybindings.shortcut(for: id) {
                    Text(shortcut.displayString)
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecondary)
                }
            }
            .padding(.horizontal, Spacing.medium)
            .padding(.vertical, Spacing.small)
            .contentShape(Rectangle())
            .background(selected ? AnyShapeStyle(Palette.accent.opacity(0.2)) : AnyShapeStyle(Color.clear))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("pica.palette.item.\(item.id)")
    }

    private func run(_ item: PaletteItem?) {
        guard let item else { return }
        model.isPresented = false
        // After the sheet has gone, so an action that presents something presents it over the window.
        Task { @MainActor in
            switch item.target {
            case .action(let id): registry.perform(id)
            case .other(let id): runOther(id)
            }
        }
    }
}
