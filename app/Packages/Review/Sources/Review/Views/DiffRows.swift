import DesignSystem
import PicaProtocol
import SwiftUI

/// Colors of the diff: a tint behind added and removed lines, and one color per syntax token, all from the palette so
/// every appearance keeps its contrast.
enum DiffColors {
    static let addedTint = Palette.success
    static let removedTint = Palette.danger
    static let gutter = Palette.textSecondary

    static func token(_ token: SyntaxToken) -> PicaColor {
        switch token {
        case .keyword: Palette.accent
        case .string: Palette.success
        case .comment: Palette.textSecondary
        case .number: Palette.warning
        }
    }

    static func background(_ kind: DiffLine.Kind?) -> AnyShapeStyle {
        switch kind {
        case .added: AnyShapeStyle(addedTint.opacity(0.14))
        case .removed: AnyShapeStyle(removedTint.opacity(0.14))
        case .context: AnyShapeStyle(Palette.surface)
        case nil: AnyShapeStyle(Palette.background)
        }
    }

    static func marker(_ kind: DiffLine.Kind) -> String {
        switch kind {
        case .added: "+"
        case .removed: "−"
        case .context: " "
        }
    }
}

/// A line's text with its syntax colored. Highlighting happens here, when the row is drawn, so a long diff costs only
/// what is on screen.
struct HighlightedText: View {
    let text: DiffText
    let language: SyntaxLanguage?
    let states: SyntaxStates
    @Environment(\.self) private var environment

    var body: some View {
        Text(attributed)
            .font(Typography.code)
            .foregroundStyle(Palette.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var attributed: AttributedString {
        var string = AttributedString(text.text)
        guard let language else { return string }
        let utf8 = text.text.utf8
        for span in language.spans(of: text.text, from: states.state(text.side, text.index)) {
            let lower = utf8.index(utf8.startIndex, offsetBy: span.range.lowerBound)
            let upper = utf8.index(utf8.startIndex, offsetBy: span.range.upperBound)
            guard let range = Range(lower..<upper, in: string) else { continue }
            string[range].foregroundColor = Color(DiffColors.token(span.token).resolve(in: environment))
        }
        return string
    }
}

struct LineNumber: View {
    let number: Int?

    var body: some View {
        Text(number.map(String.init) ?? "")
            .font(Typography.code)
            .foregroundStyle(DiffColors.gutter)
            .frame(width: 40, alignment: .trailing)
            .padding(.trailing, Spacing.xSmall)
    }
}

/// One row of the unified diff.
struct UnifiedLineRow: View {
    let kind: DiffLine.Kind
    let oldLine: Int?
    let newLine: Int?
    let text: DiffText
    let language: SyntaxLanguage?
    let states: SyntaxStates

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            LineNumber(number: oldLine)
            LineNumber(number: newLine)
            Text(DiffColors.marker(kind))
                .font(Typography.code)
                .foregroundStyle(DiffColors.gutter)
                .frame(width: 14)
            HighlightedText(text: text, language: language, states: states)
        }
        .padding(.vertical, 1)
        .background(DiffColors.background(kind))
    }
}

/// One row of the split diff: the old side on the left, the new on the right.
struct SplitLineRow: View {
    let left: SplitSide?
    let right: SplitSide?
    let language: SyntaxLanguage?
    let states: SyntaxStates

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            side(left)
            Divider()
            side(right)
        }
    }

    private func side(_ side: SplitSide?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            LineNumber(number: side?.text.line)
            Text(side.map { DiffColors.marker($0.kind) } ?? " ")
                .font(Typography.code)
                .foregroundStyle(DiffColors.gutter)
                .frame(width: 14)
            if let side {
                HighlightedText(text: side.text, language: language, states: states)
            } else {
                Spacer(minLength: 0)
            }
        }
        .padding(.vertical, 1)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DiffColors.background(side?.kind))
    }
}

/// A hunk's header, with the actions that move just that hunk.
struct HunkHeaderRow: View {
    let index: Int
    let header: String
    let file: ReviewFile
    let separable: Bool
    let actions: ReviewActions

    var body: some View {
        HStack(spacing: Spacing.small) {
            Text(header)
                .font(Typography.code)
                .foregroundStyle(Palette.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: Spacing.small)
            if separable {
                let target = ChangeTarget(path: file.path, hunkIndexes: [index])
                switch file.side {
                case .unstaged:
                    Button("Discard Hunk") { actions.discard(target) }
                        .accessibilityIdentifier("pica.review.hunk.\(index).discard")
                    Button("Stage Hunk") { actions.stage(target) }
                        .accessibilityIdentifier("pica.review.hunk.\(index).stage")
                case .staged:
                    Button("Unstage Hunk") { actions.unstage(target) }
                        .accessibilityIdentifier("pica.review.hunk.\(index).unstage")
                }
            }
        }
        .buttonStyle(.pica(.secondary))
        .controlSize(.small)
        .padding(.horizontal, Spacing.small)
        .padding(.vertical, Spacing.xSmall)
        .background(Palette.background)
        .overlay(alignment: .bottom) { Divider() }
    }
}

/// What a row asks the review to do. The views hold no store, so the snapshot tests can draw them with no engine.
struct ReviewActions {
    var stage: (ChangeTarget) -> Void = { _ in }
    var unstage: (ChangeTarget) -> Void = { _ in }
    var discard: (ChangeTarget) -> Void = { _ in }
}
