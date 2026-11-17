import DesignSystem
import SwiftUI

/// Draws a `MarkdownDocument` with the design system's type and colors.
struct MarkdownView: View {
    let document: MarkdownDocument

    var body: some View {
        MarkdownBlocks(blocks: document.blocks)
    }
}

private struct MarkdownBlocks: View {
    let blocks: [MarkdownBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            ForEach(blocks.indices, id: \.self) { index in
                MarkdownBlockView(block: blocks[index])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block {
        case .heading(let level, let text):
            Text(text)
                .font(Self.headingFont(level))
                .foregroundStyle(Palette.textPrimary)
                .padding(.top, level <= 2 ? Spacing.xSmall : 0)
                .accessibilityAddTraits(.isHeader)
        case .paragraph(let text):
            Text(text)
                .font(Typography.body)
                .foregroundStyle(Palette.textPrimary)
                .tint(Palette.accent)
                .fixedSize(horizontal: false, vertical: true)
        case .code(let language, let code):
            CodeBlockView(language: language, code: code)
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: Spacing.xSmall) {
                ForEach(items.indices, id: \.self) { index in
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.small) {
                        Text(ordered ? "\(start + index)." : "•")
                            .font(Typography.body.monospacedDigit())
                            .foregroundStyle(Palette.textSecondary)
                        MarkdownBlocks(blocks: items[index])
                    }
                }
            }
        case .quote(let blocks):
            MarkdownBlocks(blocks: blocks)
                .padding(.leading, Spacing.medium)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Palette.border).frame(width: 3)
                }
        case .table(let header, let rows):
            MarkdownTable(header: header, rows: rows)
        case .rule:
            Rectangle().fill(Palette.border).frame(height: 1).padding(.vertical, Spacing.xSmall)
        }
    }

    private static func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: Typography.title
        case 2: .system(size: 16, weight: .semibold)
        default: Typography.headline
        }
    }
}

private struct CodeBlockView: View {
    let language: String?
    let code: String

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.medium, style: .continuous)
        VStack(alignment: .leading, spacing: Spacing.xSmall) {
            if let language, !language.isEmpty {
                Text(language)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
            Text(code)
                .font(Typography.code)
                .foregroundStyle(Palette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.small)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(shape.fill(Palette.surface))
        .overlay(shape.strokeBorder(Palette.border, lineWidth: 1))
    }
}

private struct MarkdownTable: View {
    let header: [AttributedString]
    let rows: [[AttributedString]]

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: Spacing.medium, verticalSpacing: Spacing.xSmall) {
            GridRow {
                ForEach(header.indices, id: \.self) { column in
                    Text(header[column]).font(Typography.headline)
                }
            }
            Rectangle().fill(Palette.border).frame(height: 1).gridCellUnsizedAxes(.horizontal)
            ForEach(rows.indices, id: \.self) { row in
                GridRow {
                    ForEach(rows[row].indices, id: \.self) { column in
                        Text(rows[row][column]).font(Typography.body)
                    }
                }
            }
        }
        .foregroundStyle(Palette.textPrimary)
    }
}
