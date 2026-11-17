import Testing
@testable import Review

/// The lexer's spans, as `token:text`, for one line of each kind it knows.
@Suite struct SyntaxHighlighterTests {
    private func tokens(_ line: String, _ path: String, from state: SyntaxState = .code) throws -> [String] {
        let language = try #require(SyntaxLanguage(path: path))
        let bytes = Array(line.utf8)
        return language.spans(of: line, from: state).map { span in
            "\(span.token):\(String(decoding: bytes[span.range], as: UTF8.self))"
        }
    }

    @Test(arguments: [
        ("let x = 42 // answer", "a.swift", ["keyword:let", "number:42", "comment:// answer"]),
        ("return \"a \\\" b\" + y", "a.swift", ["keyword:return", "string:\"a \\\" b\""]),
        ("const s = 'x'; /* c */ if (a)", "a.ts", ["keyword:const", "string:'x'", "comment:/*", "comment: c */", "keyword:if"]),
        ("def f(n): return None  # done", "a.py", ["keyword:def", "keyword:return", "keyword:None", "comment:# done"]),
        ("letter = x1 + 3.5e2", "a.py", ["number:3.5e2"]),
        ("echo \"$HOME\" # path", "build.sh", ["string:\"$HOME\"", "comment:# path"]),
        ("  \"name\": true,", "package.json", ["string:\"name\"", "keyword:true"]),
        ("all: build", "Makefile", []),
    ])
    func linesHaveTheirTokens(line: String, path: String, expected: [String]) throws {
        #expect(try tokens(line, path) == expected)
    }

    @Test func blockCommentsAndLongStringsCarryOverLines() throws {
        let swift = try #require(SyntaxLanguage(path: "Sources/x.swift"))
        #expect(swift.state(after: "let a = 1 /* starts", from: .code) == .blockComment)
        #expect(try tokens("still comment */ var b", "x.swift", from: .blockComment) == ["comment:still comment */", "keyword:var"])
        #expect(swift.state(after: "let s = \"\"\"", from: .code) == .string(delimiter: "\"\"\""))
        #expect(try tokens("text\"\"\" + x", "x.swift", from: .string(delimiter: "\"\"\"")) == ["string:text\"\"\""])
        let python = try #require(SyntaxLanguage(path: "a.py"))
        #expect(python.state(after: "doc = '''", from: .code) == .string(delimiter: "'''"))
    }

    @Test func unknownFilesAreNotHighlighted() {
        #expect(SyntaxLanguage(path: "README.md") == nil)
        #expect(SyntaxLanguage(path: "image.bin") == nil)
    }

    @Test func keywordsInsideNamesAreNotKeywords() throws {
        #expect(try tokens("letter iffy x_if", "a.swift") == [])
    }
}
