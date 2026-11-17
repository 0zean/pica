import PicaProtocol

/// One side of a diff line: its text, where it is in its file, and where `SyntaxStates` keeps the state it starts in.
struct DiffText: Hashable, Sendable {
    let text: String
    let line: Int?
    let side: SyntaxStates.Side
    let index: Int
}

/// A row of the unified diff: a hunk's header, or one line of it.
struct UnifiedRow: Identifiable, Hashable, Sendable {
    enum Content: Hashable, Sendable {
        case hunk(index: Int, header: String)
        case line(kind: DiffLine.Kind, oldLine: Int?, newLine: Int?, text: DiffText)
    }

    let id: Int
    let content: Content
}

/// A row of the split diff: a hunk's header, or the old line on the left and the new one on the right. Removed lines
/// are paired with the added lines that follow them; a side with nothing to pair is empty.
struct SplitRow: Identifiable, Hashable, Sendable {
    enum Content: Hashable, Sendable {
        case hunk(index: Int, header: String)
        case pair(left: SplitSide?, right: SplitSide?)
    }

    let id: Int
    let content: Content
}

struct SplitSide: Hashable, Sendable {
    let kind: DiffLine.Kind
    let text: DiffText
}

/// A file's diff laid out for drawing, both ways. Building it is linear in the number of lines and lexes nothing:
/// highlighting a line, and working out the state it starts in, happen only when its row is drawn.
@MainActor
struct DiffDocument {
    let file: FileDiff
    let language: SyntaxLanguage?
    let states: SyntaxStates
    let unified: [UnifiedRow]
    let split: [SplitRow]
    let lineCount: Int

    init(file: FileDiff) {
        self.file = file
        let language = SyntaxLanguage(path: file.path)
        self.language = language
        let states = SyntaxStates(language: language)
        self.states = states
        var unified: [UnifiedRow] = []
        var split: [SplitRow] = []
        var lineCount = 0
        for (index, hunk) in file.hunks.enumerated() {
            unified.append(UnifiedRow(id: unified.count, content: .hunk(index: index, header: hunk.header)))
            split.append(SplitRow(id: split.count, content: .hunk(index: index, header: hunk.header)))
            var removed: [SplitSide] = []
            var added: [SplitSide] = []
            var firstOld = true
            var firstNew = true
            func text(_ line: DiffLine, _ side: SyntaxStates.Side) -> DiffText {
                let starts = side == .old ? firstOld : firstNew
                if side == .old { firstOld = false } else { firstNew = false }
                let position = states.append(line.text, to: side, startsHunk: starts)
                return DiffText(text: line.text, line: side == .old ? line.oldLine : line.newLine, side: side, index: position)
            }
            func flush() {
                for offset in 0..<max(removed.count, added.count) {
                    split.append(SplitRow(id: split.count, content: .pair(left: removed[safe: offset], right: added[safe: offset])))
                }
                removed.removeAll(keepingCapacity: true)
                added.removeAll(keepingCapacity: true)
            }
            for line in hunk.lines {
                lineCount += 1
                switch line.kind {
                case .context:
                    flush()
                    let left = text(line, .old)
                    let right = text(line, .new)
                    unified.append(UnifiedRow(
                        id: unified.count, content: .line(kind: .context, oldLine: line.oldLine, newLine: line.newLine, text: right)))
                    split.append(SplitRow(
                        id: split.count, content: .pair(left: SplitSide(kind: .context, text: left), right: SplitSide(kind: .context, text: right))))
                case .removed:
                    if !added.isEmpty { flush() }
                    let old = text(line, .old)
                    unified.append(UnifiedRow(id: unified.count, content: .line(kind: .removed, oldLine: line.oldLine, newLine: nil, text: old)))
                    removed.append(SplitSide(kind: .removed, text: old))
                case .added:
                    let new = text(line, .new)
                    unified.append(UnifiedRow(id: unified.count, content: .line(kind: .added, oldLine: nil, newLine: line.newLine, text: new)))
                    added.append(SplitSide(kind: .added, text: new))
                }
            }
            flush()
        }
        self.unified = unified
        self.split = split
        self.lineCount = lineCount
    }

    /// Why the file has no lines to show, if it has none.
    var placeholder: String? {
        if file.binary { return "Binary file not shown" }
        guard file.hunks.isEmpty else { return nil }
        switch file.change {
        case .renamed: return "Renamed without changes"
        case .copied: return "Copied without changes"
        case .typeChanged: return "File type changed"
        case .unmerged: return "Unmerged: resolve the conflict, then stage the file"
        default: return "No changes to show"
        }
    }

    /// Hunks can be staged, unstaged or discarded one at a time only in a modified text file (docs/review.md).
    var hunksAreSeparable: Bool {
        file.change == .modified && !file.binary && file.hunks.count > 0
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
