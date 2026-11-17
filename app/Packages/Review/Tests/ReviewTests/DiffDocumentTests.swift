import PicaProtocol
import Testing
@testable import Review

@MainActor
@Suite struct DiffDocumentTests {
    static func line(_ kind: DiffLine.Kind, _ text: String, _ old: Int?, _ new: Int?) -> DiffLine {
        DiffLine(kind: kind, text: text, oldLine: old, newLine: new)
    }

    static let file = FileDiff(
        path: "Sources/a.swift", originalPath: nil, change: .modified, binary: false,
        hunks: [
            DiffHunk(header: "@@ -1,4 +1,5 @@", lines: [
                line(.context, "import A", 1, 1),
                line(.removed, "let a = 1", 2, nil),
                line(.removed, "let b = 2", 3, nil),
                line(.added, "let a = 10", nil, 2),
                line(.added, "let b = 20", nil, 3),
                line(.added, "let c = 30", nil, 4),
                line(.context, "/* note", 4, 5),
            ]),
            DiffHunk(header: "@@ -9 +10 @@", lines: [line(.added, "done()", nil, 10)]),
        ])

    @Test func unifiedRowsAreTheHunkHeadersAndEveryLine() {
        let document = DiffDocument(file: Self.file)
        #expect(document.lineCount == 8)
        #expect(document.unified.count == 10)
        #expect(document.unified.map(\.id) == Array(0..<10))
        guard case .hunk(1, "@@ -9 +10 @@") = document.unified[8].content else {
            Issue.record("row 8 is not the second hunk's header")
            return
        }
    }

    @Test func splitRowsPairRemovedLinesWithTheAddedLinesAfterThem() {
        let document = DiffDocument(file: Self.file)
        let pairs: [String] = document.split.map { row in
            switch row.content {
            case .hunk(let index, _): return "hunk \(index)"
            case .pair(let left, let right): return "\(left?.text.text ?? "-") | \(right?.text.text ?? "-")"
            }
        }
        #expect(pairs == [
            "hunk 0",
            "import A | import A",
            "let a = 1 | let a = 10",
            "let b = 2 | let b = 20",
            "- | let c = 30",
            "/* note | /* note",
            "hunk 1",
            "- | done()",
        ])
    }

    @Test func eachLineStartsInTheStateTheLinesBeforeItLeft() {
        var file = Self.file
        file.hunks[0].lines.append(Self.line(.context, "still a comment */", 5, 6))
        let document = DiffDocument(file: file)
        guard case .line(_, _, _, let text) = document.unified[8].content else {
            Issue.record("row 8 is not a line")
            return
        }
        #expect(text.text == "still a comment */")
        #expect(document.states.state(text.side, text.index) == .blockComment)
        guard case .line(_, _, _, let first) = document.unified[1].content else { return }
        #expect(document.states.state(first.side, first.index) == .code)
        // The second hunk starts from plain code whatever the first left open.
        file.hunks[1].lines.insert(Self.line(.context, "x", 9, 10), at: 0)
        let reset = DiffDocument(file: file)
        guard case .line(_, _, _, let afterGap) = reset.unified[10].content else { return }
        #expect(afterGap.text == "x")
        #expect(reset.states.state(afterGap.side, afterGap.index) == .code)
    }

    @Test func hunksSplitOnlyInModifiedTextFiles() {
        #expect(DiffDocument(file: Self.file).hunksAreSeparable)
        var added = Self.file
        added.change = .untracked
        #expect(!DiffDocument(file: added).hunksAreSeparable)
        let binary = FileDiff(path: "image.bin", originalPath: nil, change: .modified, binary: true, hunks: [])
        #expect(!DiffDocument(file: binary).hunksAreSeparable)
        #expect(DiffDocument(file: binary).placeholder == "Binary file not shown")
        let renamed = FileDiff(path: "b.txt", originalPath: "a.txt", change: .renamed, binary: false, hunks: [])
        #expect(DiffDocument(file: renamed).placeholder == "Renamed without changes")
        #expect(DiffDocument(file: Self.file).placeholder == nil)
    }
}
