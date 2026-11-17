import DesignSystem
import EngineClient
import PicaProtocol
import SwiftUI

/// The Files inspector pane: the workspace's repos as a tree. A file opens in the viewer; its menu also opens it in
/// the external editor.
public struct FileTreeView: View {
    @State private var store: FileTreeStore
    private let workspaceId: Id
    private let editor: ExternalEditor
    @Environment(\.openWindow) private var openWindow

    public init(workspaceId: Id, client: EngineClient, editor: ExternalEditor) {
        self.workspaceId = workspaceId
        self.editor = editor
        _store = State(initialValue: FileTreeStore(backend: EngineFilesBackend(client: client)))
    }

    public var body: some View {
        Group {
            if let failure = store.loadFailure {
                EmptyState("Files unavailable", message: failure)
            } else if store.rows.isEmpty {
                EmptyState("No repos", message: "Add a repo to this workspace to browse its files.")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(store.rows) { row in
                            FileTreeRow(row: row, failure: store.failures[row.id])
                                .contentShape(Rectangle())
                                .onTapGesture { activate(row) }
                                .contextMenu { menu(for: row) }
                                .accessibilityElement(children: .combine)
                                .accessibilityAddTraits(.isButton)
                                .accessibilityIdentifier("pica.files.row.\(identifier(row))")
                        }
                    }
                    .padding(.vertical, Spacing.xSmall)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: workspaceId) { await store.load(workspaceId: workspaceId) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pica.files.tree")
    }

    private func activate(_ row: FileTreeStore.Row) {
        if let reference = store.reference(for: row) {
            openWindow(id: FileViewerScreen.windowId, value: reference)
        } else {
            Task { await store.toggle(row) }
        }
    }

    @ViewBuilder private func menu(for row: FileTreeStore.Row) -> some View {
        if let reference = store.reference(for: row) {
            Button("Open") { openWindow(id: FileViewerScreen.windowId, value: reference) }
            if let url = reference.fileURL {
                Button("Open in External Editor") { editor(url) }
            }
        }
    }

    /// `atlas:src/main.ts`, or `atlas:` for the repo itself.
    private func identifier(_ row: FileTreeStore.Row) -> String {
        let repo = store.repos.first { $0.id == row.repoId }?.shortName ?? row.repoId
        return "\(repo):\(row.path)"
    }
}

private struct FileTreeRow: View {
    let row: FileTreeStore.Row
    let failure: String?

    var body: some View {
        HStack(spacing: Spacing.xSmall) {
            Image(systemName: row.isExpanded ? "chevron.down" : "chevron.right")
                .font(.system(size: 9, weight: .semibold))
                .frame(width: 10)
                .foregroundStyle(Palette.textSecondary)
                .opacity(row.kind == .file ? 0 : 1)
                .accessibilityHidden(true)
            Image(systemName: symbol)
                .frame(width: 16)
                .foregroundStyle(row.kind == .file ? Palette.textSecondary : Palette.accent)
                .accessibilityHidden(true)
            Text(row.name)
                .font(row.kind == .repo ? Typography.headline : Typography.body)
                .foregroundStyle(Palette.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            if let failure {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(Palette.textSecondary)
                    .help(failure)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, Spacing.small + CGFloat(row.depth) * Spacing.medium)
        .padding(.trailing, Spacing.small)
        .padding(.vertical, Spacing.xxSmall + 1)
    }

    private var symbol: String {
        switch row.kind {
        case .repo: "shippingbox"
        case .directory: row.isExpanded ? "folder.fill" : "folder"
        case .file: "doc.text"
        }
    }
}
