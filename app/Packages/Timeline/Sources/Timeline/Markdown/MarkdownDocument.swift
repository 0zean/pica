import Foundation
import Markdown

/// Assistant text parsed as GitHub-flavored Markdown into the blocks the timeline draws. Inline formatting is kept as
/// `inlinePresentationIntent` and `link` attributes, which SwiftUI's `Text` renders as they are.
///
/// Streaming text is parsed whole each time it grows: an unclosed code fence simply runs to the end of the text, as
/// CommonMark says, so a half-written message renders as a valid document.
public struct MarkdownDocument: Equatable, Sendable {
    public let blocks: [MarkdownBlock]

    public init(parsing text: String) {
        blocks = MarkdownConverter.blocks(Document(parsing: text, options: [.disableSmartOpts]).children)
    }
}

public indirect enum MarkdownBlock: Equatable, Sendable {
    case heading(level: Int, AttributedString)
    case paragraph(AttributedString)
    case code(language: String?, String)
    case list(ordered: Bool, start: Int, items: [[MarkdownBlock]])
    case quote([MarkdownBlock])
    case table(header: [AttributedString], rows: [[AttributedString]])
    case rule
}

private enum MarkdownConverter {
    static func blocks(_ children: MarkupChildren) -> [MarkdownBlock] {
        children.compactMap(block)
    }

    static func block(_ markup: any Markup) -> MarkdownBlock? {
        switch markup {
        case let heading as Heading:
            return .heading(level: heading.level, inline(heading.children))
        case let paragraph as Paragraph:
            return .paragraph(inline(paragraph.children))
        case let code as CodeBlock:
            return .code(language: code.language, code.code.hasSuffix("\n") ? String(code.code.dropLast()) : code.code)
        case let list as UnorderedList:
            return .list(ordered: false, start: 1, items: list.listItems.map { blocks($0.children) })
        case let list as OrderedList:
            return .list(ordered: true, start: Int(list.startIndex), items: list.listItems.map { blocks($0.children) })
        case let quote as BlockQuote:
            return .quote(blocks(quote.children))
        case let table as Markdown.Table:
            return .table(
                header: table.head.cells.map { inline($0.children) },
                rows: table.body.rows.map { row in row.cells.map { inline($0.children) } })
        case is ThematicBreak:
            return .rule
        case let html as HTMLBlock:
            return .code(language: "html", html.rawHTML.trimmingCharacters(in: .newlines))
        default:
            return nil
        }
    }

    static func inline(_ children: MarkupChildren, intent: InlinePresentationIntent = []) -> AttributedString {
        children.reduce(into: AttributedString()) { result, child in
            result += inline(child, intent: intent)
        }
    }

    static func inline(_ markup: any Markup, intent: InlinePresentationIntent) -> AttributedString {
        switch markup {
        case let text as Markdown.Text:
            return styled(text.string, intent)
        case let emphasis as Emphasis:
            return inline(emphasis.children, intent: intent.union(.emphasized))
        case let strong as Strong:
            return inline(strong.children, intent: intent.union(.stronglyEmphasized))
        case let strikethrough as Strikethrough:
            return inline(strikethrough.children, intent: intent.union(.strikethrough))
        case let code as InlineCode:
            return styled(code.code, intent.union(.code))
        case let link as Markdown.Link:
            var text = inline(link.children, intent: intent)
            if let destination = link.destination, let url = URL(string: destination) {
                text.link = url
            }
            return text
        case let image as Markdown.Image:
            return styled(image.plainText, intent)
        case is SoftBreak:
            return styled(" ", intent)
        case is LineBreak:
            return styled("\n", intent)
        case let html as InlineHTML:
            return styled(html.rawHTML, intent)
        default:
            return styled(markup.format(), intent)
        }
    }

    static func styled(_ string: String, _ intent: InlinePresentationIntent) -> AttributedString {
        var text = AttributedString(string)
        if !intent.isEmpty {
            text.inlinePresentationIntent = intent
        }
        return text
    }
}
