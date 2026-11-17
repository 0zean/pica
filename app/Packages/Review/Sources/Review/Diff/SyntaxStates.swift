/// The syntax state each line of a diff starts in, worked out on demand: a line's state depends on every line before
/// it on its side, so asking for one works forward from the last line already known. Drawing the first screen of a
/// long diff reads only its first lines. The old side is the context and removed lines, the new side the context and
/// added lines; each hunk starts from plain code, since hunks are not contiguous.
@MainActor
final class SyntaxStates {
    enum Side: Hashable, Sendable {
        case old
        case new
    }

    private let language: SyntaxLanguage?
    private var texts: [Side: [String]] = [.old: [], .new: []]
    private var hunkStarts: [Side: Set<Int>] = [.old: [], .new: []]
    private var known: [Side: [SyntaxState]] = [.old: [], .new: []]

    init(language: SyntaxLanguage?) {
        self.language = language
    }

    /// Adds a line to a side and returns its index there.
    func append(_ text: String, to side: Side, startsHunk: Bool) -> Int {
        let index = texts[side, default: []].count
        texts[side, default: []].append(text)
        if startsHunk { hunkStarts[side, default: []].insert(index) }
        return index
    }

    func state(_ side: Side, _ index: Int) -> SyntaxState {
        guard let language else { return .code }
        var states = known[side] ?? []
        guard index >= states.count else { return states[index] }
        let lines = texts[side] ?? []
        let starts = hunkStarts[side] ?? []
        while states.count <= index, states.count < lines.count {
            let next = states.count
            if next == 0 || starts.contains(next) {
                states.append(.code)
            } else {
                states.append(language.state(after: lines[next - 1], from: states[next - 1]))
            }
        }
        known[side] = states
        return states[safe: index] ?? .code
    }
}
