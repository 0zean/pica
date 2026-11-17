import AppKit
import DesignSystem
import EngineClient
import SwiftUI

/// The read-only viewer, in a window of its own per file (the app target's `WindowGroup(id: windowId, for:
/// FileReference.self)`).
public struct FileViewerScreen: View {
    public static let windowId = "file-viewer"

    @State private var store: FileViewerStore
    private let editor: ExternalEditor

    public init(reference: FileReference, client: EngineClient, editor: ExternalEditor) {
        self.editor = editor
        _store = State(initialValue: FileViewerStore(reference: reference, backend: EngineFilesBackend(client: client)))
    }

    public init(store: FileViewerStore, editor: ExternalEditor) {
        self.editor = editor
        _store = State(initialValue: store)
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            switch store.content {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .unavailable(let message):
                EmptyState("Can’t show this file", message: message)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("pica.viewer.unavailable")
            case .text(let text, _, _):
                ReadOnlyText(text: text)
                    .accessibilityIdentifier("pica.viewer.text")
            }
        }
        .frame(minWidth: 480, minHeight: 320)
        .background(Palette.background)
        .navigationTitle(store.reference.fileName)
        .task { await store.load() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.viewer")
    }

    private var header: some View {
        HStack(spacing: Spacing.small) {
            VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                Text(store.reference.path)
                    .font(Typography.headline)
                    .foregroundStyle(Palette.textPrimary)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("pica.viewer.path")
                Text(detail)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
            Spacer()
            if let url = store.reference.fileURL {
                Button("Open in External Editor") { editor(url) }
                    .buttonStyle(.pica(.secondary))
                    .keyboardShortcut("o", modifiers: [.command, .shift])
                    .accessibilityIdentifier("pica.viewer.openExternal")
            }
        }
        .padding(.horizontal, Spacing.large)
        .padding(.vertical, Spacing.small)
    }

    private var detail: String {
        var parts = [store.reference.repoName, "Read only"]
        if case .text(_, let truncated, let size) = store.content {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
            if truncated { parts.append("Showing the first 1 MB") }
        }
        return parts.joined(separator: " · ")
    }
}

/// An `NSTextView` that can be selected and searched but not edited; SwiftUI's `Text` is slow on files of thousands
/// of lines.
private struct ReadOnlyText: NSViewRepresentable {
    let text: String

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        scroll.hasHorizontalScroller = true
        guard let view = scroll.documentView as? NSTextView else { return scroll }
        view.isEditable = false
        view.isSelectable = true
        view.usesFindBar = true
        view.isIncrementalSearchingEnabled = true
        view.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        view.textColor = .labelColor
        view.backgroundColor = .textBackgroundColor
        view.textContainerInset = NSSize(width: 12, height: 10)
        // Long lines scroll sideways instead of wrapping, as in an editor.
        view.isHorizontallyResizable = true
        view.textContainer?.widthTracksTextView = false
        view.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        view.setAccessibilityIdentifier("pica.viewer.textView")
        view.string = text
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? NSTextView, view.string != text else { return }
        view.string = text
    }
}
