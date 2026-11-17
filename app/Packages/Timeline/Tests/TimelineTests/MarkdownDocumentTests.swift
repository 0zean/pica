import Foundation
import Testing
@testable import Timeline

@Suite struct MarkdownDocumentTests {
    @Test func blocksAreParsed() {
        let document = MarkdownDocument(parsing: """
            # Title

            Some *emphasis*.

            - one
            - two

            3. three

            ```swift
            let x = 1
            ```

            > quoted

            | a | b |
            |---|---|
            | 1 | 2 |

            ---
            """)
        let kinds = document.blocks.map(Self.kind)
        #expect(kinds == ["heading", "paragraph", "list", "list", "code", "quote", "table", "rule"])
        #expect(document.blocks[4] == .code(language: "swift", "let x = 1"))
        guard case .list(true, 3, let items) = document.blocks[3] else {
            Issue.record("expected an ordered list starting at 3")
            return
        }
        #expect(items.count == 1)
    }

    @Test func inlineFormattingBecomesPresentationIntents() {
        guard case .paragraph(let text) = MarkdownDocument(parsing: "a **b** `c` [d](https://example.com)").blocks.first else {
            Issue.record("expected a paragraph")
            return
        }
        let runs = text.runs.map { (String(text[$0.range].characters), $0.inlinePresentationIntent, $0.link) }
        #expect(runs.contains { $0.0 == "b" && $0.1 == .stronglyEmphasized })
        #expect(runs.contains { $0.0 == "c" && $0.1 == .code })
        #expect(runs.contains { $0.0 == "d" && $0.2 == URL(string: "https://example.com") })
    }

    @Test func anUnclosedFenceWhileStreamingRunsToTheEnd() {
        let document = MarkdownDocument(parsing: "Intro\n\n```ts\nexpect(route(")
        #expect(document.blocks.last == .code(language: "ts", "expect(route("))
    }

    private static func kind(_ block: MarkdownBlock) -> String {
        switch block {
        case .heading: "heading"
        case .paragraph: "paragraph"
        case .code: "code"
        case .list: "list"
        case .quote: "quote"
        case .table: "table"
        case .rule: "rule"
        }
    }
}
