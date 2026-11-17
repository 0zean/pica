import DesignSystem
import EngineClient
import Observation
import PicaProtocol
import SwiftUI

/// Whether ⌘P's panel is showing, and its search. The app target owns one for the main window: the Quick Open command
/// presents it for the selected workspace, and the window draws `QuickOpenPanel` over its content.
@MainActor
@Observable
public final class QuickOpen {
    public private(set) var isPresented = false
    public let store: QuickOpenStore

    public init(client: EngineClient) {
        store = QuickOpenStore(backend: EngineFilesBackend(client: client))
    }

    public init(store: QuickOpenStore) {
        self.store = store
    }

    public func present(workspaceId: Id?, repos: [Repo]) {
        store.begin(workspaceId: workspaceId, repos: repos)
        isPresented = true
    }

    public func dismiss() {
        isPresented = false
    }
}

/// ⌘P: a field over the window and the best matches under it. ↑ and ↓ move, Return opens the file in the viewer,
/// ⌘Return opens it in the external editor, and Escape closes.
public struct QuickOpenPanel: View {
    let quickOpen: QuickOpen
    let editor: ExternalEditor
    @State private var text = ""
    @FocusState private var focused: Bool
    @Environment(\.openWindow) private var openWindow

    public init(quickOpen: QuickOpen, editor: ExternalEditor) {
        self.quickOpen = quickOpen
        self.editor = editor
    }

    public var body: some View {
        let store = quickOpen.store
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: Spacing.small) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityHidden(true)
                TextField("Search files by name", text: $text)
                    .textFieldStyle(.plain)
                    .font(Typography.body)
                    .focused($focused)
                    .accessibilityIdentifier("pica.quickOpen.field")
                    .onChange(of: text) { store.setQuery(text) }
                    .onKeyPress(.downArrow) { store.moveSelection(by: 1); return .handled }
                    .onKeyPress(.upArrow) { store.moveSelection(by: -1); return .handled }
                    .onKeyPress(.escape) { quickOpen.dismiss(); return .handled }
                    .onKeyPress(.return, phases: .down) { press in
                        open(store.selectedReference, external: press.modifiers.contains(.command))
                        return .handled
                    }
            }
            .padding(Spacing.medium)
            Divider()
            if let message = store.message {
                Text(message)
                    .font(Typography.callout)
                    .foregroundStyle(Palette.textSecondary)
                    .padding(Spacing.medium)
                    .accessibilityIdentifier("pica.quickOpen.message")
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(store.rows.enumerated()), id: \.element.id) { index, row in
                            QuickOpenRow(row: row, selected: index == store.selected)
                                .id(row.id)
                                .contentShape(Rectangle())
                                .onTapGesture { open(row.reference, external: false) }
                                .accessibilityElement(children: .combine)
                                .accessibilityAddTraits(index == store.selected ? [.isButton, .isSelected] : .isButton)
                                .accessibilityIdentifier("pica.quickOpen.row.\(row.reference.repoName):\(row.reference.path)")
                        }
                    }
                    .padding(Spacing.xSmall)
                }
                .frame(maxHeight: 360)
                .onChange(of: store.selected) { proxy.scrollTo(store.rows[safe: store.selected]?.id) }
            }
        }
        .frame(width: 560)
        .fixedSize(horizontal: false, vertical: true)
        .background(RoundedRectangle(cornerRadius: Radius.large, style: .continuous).fill(Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: Radius.large, style: .continuous).stroke(Palette.border))
        .shadow(color: .black.opacity(0.18), radius: 18, y: 6)
        .padding(.top, Spacing.xxLarge)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear {
            text = ""
            focused = true
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.quickOpen")
    }

    private func open(_ reference: FileReference?, external: Bool) {
        guard let reference else { return }
        quickOpen.dismiss()
        if external, let url = reference.fileURL {
            editor(url)
        } else {
            openWindow(id: FileViewerScreen.windowId, value: reference)
        }
    }
}

private struct QuickOpenRow: View {
    let row: QuickOpenStore.Row
    let selected: Bool

    var body: some View {
        HStack(spacing: Spacing.small) {
            Image(systemName: "doc.text")
                .frame(width: 16)
                .foregroundStyle(selected ? Palette.onAccent : Palette.textSecondary)
                .accessibilityHidden(true)
            Text(row.reference.fileName)
                .font(Typography.body)
                .foregroundStyle(selected ? Palette.onAccent : Palette.textPrimary)
                .lineLimit(1)
            Text(row.directory.isEmpty ? row.reference.repoName : "\(row.reference.repoName) · \(row.directory)")
                .font(Typography.caption)
                .foregroundStyle(selected ? Palette.onAccent : Palette.textSecondary)
                .lineLimit(1)
                .truncationMode(.head)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.small)
        .padding(.vertical, Spacing.xSmall)
        .background(
            RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                .fill(selected ? AnyShapeStyle(Palette.accent) : AnyShapeStyle(Color.clear)))
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

/// File ▸ Quick Open… (⌘P). ⌘P is taken from Print, which Pica has nothing to offer for.
public struct QuickOpenCommands: Commands {
    private let present: @MainActor () -> Void

    public init(present: @escaping @MainActor () -> Void) {
        self.present = present
    }

    public var body: some Commands {
        CommandGroup(replacing: .printItem) {}
        CommandGroup(after: .newItem) {
            Button("Quick Open…", action: present)
                .keyboardShortcut("p", modifiers: .command)
        }
    }
}
