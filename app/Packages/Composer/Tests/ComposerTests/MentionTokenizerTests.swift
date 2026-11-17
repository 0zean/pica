import Composer
import Testing

/// PLAN.md A-06: the mention tokenizer, as tables of text and the tokens in it. `T` builds a token from the text it
/// covers, so each row reads as the text it expects.
@Suite struct MentionTokenizerTests {
    struct Row: CustomTestStringConvertible, Sendable {
        let text: String
        let tokens: [ComposerToken]
        var testDescription: String { text.debugDescription }
    }

    /// A token whose range is the first occurrence of `covering` in `text` (at or after `from`).
    static func token(_ kind: ComposerToken.Kind, _ name: String, in text: String, covering: String, from: Int = 0) -> ComposerToken {
        let units = Array(text.utf16)
        let target = Array(covering.utf16)
        let start = (from...(units.count - target.count)).first { Array(units[$0..<($0 + target.count)]) == target }!
        return ComposerToken(kind, start..<(start + target.count), name)
    }

    static func mention(_ name: String, _ text: String, covering: String? = nil, from: Int = 0) -> ComposerToken {
        token(.mention, name, in: text, covering: covering ?? "@\(name)", from: from)
    }

    static func skill(_ name: String, _ text: String, from: Int = 0) -> ComposerToken {
        token(.skill, name, in: text, covering: "/\(name)", from: from)
    }

    static let rows: [Row] = [
        // Plain text.
        Row(text: "", tokens: []),
        Row(text: "no mentions here", tokens: []),
        // Mentions start at the beginning, after whitespace, or after an opening bracket or quote.
        Row(text: "@atlas", tokens: [mention("atlas", "@atlas")]),
        Row(text: "look at @atlas now", tokens: [mention("atlas", "look at @atlas now")]),
        Row(text: "line one\n@atlas", tokens: [mention("atlas", "line one\n@atlas")]),
        Row(text: "\t@atlas", tokens: [mention("atlas", "\t@atlas")]),
        Row(text: "(@atlas)", tokens: [mention("atlas", "(@atlas)")]),
        Row(text: "[@atlas]", tokens: [mention("atlas", "[@atlas]")]),
        Row(text: "\"@atlas\"", tokens: [mention("atlas", "\"@atlas\"")]),
        Row(text: "'@atlas'", tokens: [mention("atlas", "'@atlas'")]),
        // …and not inside a word, an address, or a code span.
        Row(text: "mail me@example.com", tokens: []),
        Row(text: "`@atlas`", tokens: []),
        Row(text: "a@b @c", tokens: [mention("c", "a@b @c")]),
        // Names: what a mention includes and where it ends.
        Row(text: "@atlas:src/main.swift", tokens: [mention("atlas:src/main.swift", "@atlas:src/main.swift")]),
        Row(text: "@bulk-reader and @code_writer", tokens: [
            mention("bulk-reader", "@bulk-reader and @code_writer"), mention("code_writer", "@bulk-reader and @code_writer"),
        ]),
        Row(text: "@atlas, @beacon; @comet!", tokens: [
            mention("atlas", "@atlas, @beacon; @comet!"), mention("beacon", "@atlas, @beacon; @comet!"),
            mention("comet", "@atlas, @beacon; @comet!"),
        ]),
        Row(text: "see @atlas.", tokens: [mention("atlas", "see @atlas.")]),
        Row(text: "see @atlas:", tokens: [mention("atlas", "see @atlas:")]),
        Row(text: "edit @atlas:README.md.", tokens: [mention("atlas:README.md", "edit @atlas:README.md.")]),
        Row(text: "@a@b", tokens: [mention("a", "@a@b")]),
        Row(text: "@über", tokens: [mention("über", "@über")]),
        Row(text: "@🦉owl", tokens: [mention("🦉owl", "@🦉owl")]),
        Row(text: "🦉 @atlas", tokens: [mention("atlas", "🦉 @atlas")]),
        // Empty names are text.
        Row(text: "@", tokens: []),
        Row(text: "@ atlas", tokens: []),
        Row(text: "@@atlas", tokens: []),
        Row(text: "@.", tokens: []),
        // Quoted names may have spaces and end at the closing quote on the same line.
        Row(text: "@\"atlas:My Docs/a b.md\" next", tokens: [
            mention("atlas:My Docs/a b.md", "@\"atlas:My Docs/a b.md\" next", covering: "@\"atlas:My Docs/a b.md\""),
        ]),
        Row(text: "@\"\"", tokens: []),
        Row(text: "@\"unclosed name", tokens: []),
        Row(text: "@\"split\nline\"", tokens: []),
        // Skills start a line, after spaces or tabs at most, and end at whitespace.
        Row(text: "/review", tokens: [skill("review", "/review")]),
        Row(text: "/review the diff", tokens: [skill("review", "/review the diff")]),
        Row(text: "  /review", tokens: [skill("review", "  /review")]),
        Row(text: "first\n/fix-tests now", tokens: [skill("fix-tests", "first\n/fix-tests now")]),
        Row(text: "/v1.2_beta", tokens: [skill("v1.2_beta", "/v1.2_beta")]),
        Row(text: "run /review", tokens: []),
        Row(text: "/usr/bin/env", tokens: []),
        Row(text: "/review, please", tokens: []),
        Row(text: "/", tokens: []),
        Row(text: "/ review", tokens: []),
        // Both kinds together.
        Row(text: "/review @atlas:src/a.ts with @bulk-reader", tokens: [
            skill("review", "/review @atlas:src/a.ts with @bulk-reader"),
            mention("atlas:src/a.ts", "/review @atlas:src/a.ts with @bulk-reader"),
            mention("bulk-reader", "/review @atlas:src/a.ts with @bulk-reader"),
        ]),
    ]

    @Test(arguments: rows)
    func tokens(_ row: Row) {
        #expect(MentionTokenizer.tokens(in: row.text) == row.tokens)
    }

    struct QueryRow: CustomTestStringConvertible, Sendable {
        /// `|` marks the caret; it is not part of the text.
        let marked: String
        let query: CompletionQuery?
        var testDescription: String { marked.debugDescription }

        var text: String { marked.replacingOccurrences(of: "|", with: "") }
        var caret: Int { marked.utf16.count - marked.split(separator: "|", omittingEmptySubsequences: false).last!.utf16.count - 1 }
    }

    static let queries: [QueryRow] = [
        QueryRow(marked: "|", query: nil),
        QueryRow(marked: "@|", query: CompletionQuery(.mention, "", 0..<1)),
        QueryRow(marked: "look at @at|", query: CompletionQuery(.mention, "at", 8..<11)),
        QueryRow(marked: "look at @at|las now", query: CompletionQuery(.mention, "at", 8..<14)),
        QueryRow(marked: "look at @atlas |", query: nil),
        QueryRow(marked: "@atlas:src/m|", query: CompletionQuery(.mention, "atlas:src/m", 0..<12)),
        QueryRow(marked: "me@ex|", query: nil),
        QueryRow(marked: "(@be|)", query: CompletionQuery(.mention, "be", 1..<4)),
        QueryRow(marked: "@\"My Do|", query: CompletionQuery(.mention, "My Do", 0..<7)),
        QueryRow(marked: "@\"My Do|cs\" x", query: CompletionQuery(.mention, "My Do", 0..<10)),
        QueryRow(marked: "@\"done\" |", query: nil),
        QueryRow(marked: "/|", query: CompletionQuery(.skill, "", 0..<1)),
        QueryRow(marked: "/rev|", query: CompletionQuery(.skill, "rev", 0..<4)),
        QueryRow(marked: "/rev|iew it", query: CompletionQuery(.skill, "rev", 0..<7)),
        QueryRow(marked: "text\n  /fi|", query: CompletionQuery(.skill, "fi", 7..<10)),
        QueryRow(marked: "run /rev|", query: nil),
        QueryRow(marked: "/usr|/bin", query: nil),
    ]

    @Test(arguments: queries)
    func activeQuery(_ row: QueryRow) {
        #expect(MentionTokenizer.activeQuery(in: row.text, caret: row.caret) == row.query)
    }

    @Test func caretOutsideTheTextHasNoQuery() {
        #expect(MentionTokenizer.activeQuery(in: "@a", caret: 3) == nil)
        #expect(MentionTokenizer.activeQuery(in: "@a", caret: -1) == nil)
    }
}
