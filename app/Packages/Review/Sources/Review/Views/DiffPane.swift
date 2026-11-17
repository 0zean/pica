import DesignSystem
import PicaProtocol
import SwiftUI

/// The rows of a file's diff in the chosen layout. The pane puts them in a lazy stack; the snapshot tests in a plain
/// one, since `ImageRenderer` cannot draw a scroll view.
struct DiffRows: View {
    let document: DiffDocument
    let file: ReviewFile
    let layout: DiffLayout
    let actions: ReviewActions

    var body: some View {
        switch layout {
        case .unified:
            ForEach(document.unified) { row in
                switch row.content {
                case .hunk(let index, let header):
                    hunkHeader(index, header)
                case .line(let kind, let oldLine, let newLine, let text):
                    UnifiedLineRow(kind: kind, oldLine: oldLine, newLine: newLine, text: text, language: document.language, states: document.states)
                }
            }
        case .split:
            ForEach(document.split) { row in
                switch row.content {
                case .hunk(let index, let header):
                    hunkHeader(index, header)
                case .pair(let left, let right):
                    SplitLineRow(left: left, right: right, language: document.language, states: document.states)
                }
            }
        }
    }

    private func hunkHeader(_ index: Int, _ header: String) -> some View {
        HunkHeaderRow(index: index, header: header, file: file, separable: document.hunksAreSeparable, actions: actions)
    }
}

/// The selected file: its name and change, the layout picker, whole-file actions, and the diff.
struct DiffPane: View {
    let document: DiffDocument
    let file: ReviewFile
    @Binding var layout: DiffLayout
    let actions: ReviewActions
    var onAppear: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            DiffFileHeader(file: file, layout: $layout, actions: actions)
            Divider()
            if let placeholder = document.placeholder {
                DiffPlaceholder(text: placeholder)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onAppear(perform: onAppear)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        DiffRows(document: document, file: file, layout: layout, actions: actions)
                    }
                }
                .accessibilityIdentifier("pica.review.diff")
                .onAppear(perform: onAppear)
            }
        }
        .background(Palette.background)
    }
}

struct DiffFileHeader: View {
    let file: ReviewFile
    @Binding var layout: DiffLayout
    let actions: ReviewActions

    var body: some View {
        HStack(spacing: Spacing.small) {
            VStack(alignment: .leading, spacing: Spacing.xxSmall) {
                Text(file.path)
                    .font(Typography.headline)
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .accessibilityIdentifier("pica.review.diff.path")
                Text(ChangePresentation.describe(file))
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
            Spacer(minLength: Spacing.small)
            LayoutToggle(layout: $layout)
            FileActionButtons(file: file, actions: actions)
        }
        .padding(.horizontal, Spacing.medium)
        .padding(.vertical, Spacing.small)
        .background(Palette.surface)
    }
}

/// Unified or split, as two buttons: a segmented picker is an AppKit control, which `ImageRenderer` cannot draw.
struct LayoutToggle: View {
    @Binding var layout: DiffLayout

    var body: some View {
        HStack(spacing: 0) {
            option("Unified", .unified)
            option("Split", .split)
        }
        .padding(Spacing.xxSmall)
        .background(Palette.background, in: RoundedRectangle(cornerRadius: Radius.medium))
        .overlay(RoundedRectangle(cornerRadius: Radius.medium).strokeBorder(Palette.border))
    }

    private func option(_ title: String, _ value: DiffLayout) -> some View {
        Button(title) { layout = value }
            .buttonStyle(.plain)
            .font(Typography.callout)
            .foregroundStyle(layout == value ? Palette.onAccent : Palette.textPrimary)
            .padding(.horizontal, Spacing.small)
            .padding(.vertical, Spacing.xxSmall)
            .background(layout == value ? AnyShapeStyle(Palette.accent) : AnyShapeStyle(.clear), in: RoundedRectangle(cornerRadius: Radius.small))
            .accessibilityAddTraits(layout == value ? .isSelected : [])
            .accessibilityIdentifier("pica.review.layout.\(value.rawValue)")
    }
}

/// Said in place of lines for a file that has none to show.
struct DiffPlaceholder: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Typography.callout)
            .foregroundStyle(Palette.textSecondary)
            .padding(Spacing.xLarge)
            .accessibilityIdentifier("pica.review.diff.placeholder")
    }
}

/// Stage or discard a whole file in the unstaged list; unstage it in the staged one.
struct FileActionButtons: View {
    let file: ReviewFile
    let actions: ReviewActions

    var body: some View {
        let target = ChangeTarget(path: file.path)
        HStack(spacing: Spacing.xSmall) {
            switch file.side {
            case .unstaged:
                Button("Discard") { actions.discard(target) }
                    .accessibilityIdentifier("pica.review.file.discard")
                Button("Stage File") { actions.stage(target) }
                    .accessibilityIdentifier("pica.review.file.stage")
            case .staged:
                Button("Unstage File") { actions.unstage(target) }
                    .accessibilityIdentifier("pica.review.file.unstage")
            }
        }
        .buttonStyle(.pica(.secondary))
        .controlSize(.small)
    }
}

/// How a change is named in the list and the header.
enum ChangePresentation {
    static func describe(_ file: ReviewFile) -> String {
        let side = file.side == .staged ? "Staged" : "Unstaged"
        var change: String
        switch file.diff.change {
        case .added: change = "added"
        case .modified: change = "modified"
        case .deleted: change = "deleted"
        case .renamed: change = "renamed from \(file.diff.originalPath ?? "?")"
        case .copied: change = "copied from \(file.diff.originalPath ?? "?")"
        case .typeChanged: change = "type changed"
        case .unmerged: change = "unmerged"
        case .untracked: change = "new, untracked"
        }
        if file.diff.binary { change += ", binary" }
        return "\(side) · \(change)"
    }

    static func letter(_ change: FileChangeKind) -> String {
        switch change {
        case .added: "A"
        case .modified: "M"
        case .deleted: "D"
        case .renamed: "R"
        case .copied: "C"
        case .typeChanged: "T"
        case .unmerged: "U"
        case .untracked: "?"
        }
    }

    static func color(_ change: FileChangeKind) -> PicaColor {
        switch change {
        case .added, .untracked: Palette.success
        case .deleted, .unmerged: Palette.danger
        case .modified, .typeChanged: Palette.warning
        case .renamed, .copied: Palette.accent
        }
    }
}
