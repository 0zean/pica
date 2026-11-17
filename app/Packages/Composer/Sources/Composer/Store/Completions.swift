import Foundation

/// One row of the completion list.
public struct CompletionItem: Equatable, Identifiable, Sendable {
    public enum Kind: String, Equatable, Sendable {
        case repo
        case file
        case agent
        case skill
    }

    public var kind: Kind
    /// What the row shows and the name written into the text (`atlas`, `atlas:src/main.swift`, `bulk-reader`).
    public var name: String
    public var detail: String

    public var id: String { "\(kind.rawValue).\(name)" }

    public init(_ kind: Kind, _ name: String, detail: String = "") {
        self.kind = kind
        self.name = name
        self.detail = detail
    }

    /// The text that replaces the query.
    var insertion: String {
        kind == .skill ? MentionText.skill(name) : MentionText.mention(name)
    }
}

/// Ranks names against what has been typed: a prefix match first, then a match at the start of a word, then a
/// substring, then the letters in order. Case is ignored. Names that match nothing are dropped.
enum CompletionRanking {
    static func rank(_ items: [CompletionItem], query: String, limit: Int) -> [CompletionItem] {
        let query = query.lowercased()
        guard !query.isEmpty else { return Array(items.prefix(limit)) }
        let scored = items.enumerated().compactMap { offset, item -> (Int, Int, CompletionItem)? in
            score(item.name.lowercased(), query).map { ($0, offset, item) }
        }
        return scored.sorted { ($0.0, $0.1) < ($1.0, $1.1) }.prefix(limit).map(\.2)
    }

    /// Lower is better; nil is no match.
    static func score(_ name: String, _ query: String) -> Int? {
        if name.hasPrefix(query) { return 0 }
        if let range = name.range(of: query) {
            let before = name[..<range.lowerBound].last
            return before.map { "-_./: ".contains($0) } == true ? 1 : 2
        }
        var remaining = query[...]
        for character in name where character == remaining.first {
            remaining = remaining.dropFirst()
            if remaining.isEmpty { return 3 }
        }
        return nil
    }
}

/// An edit to the composer's text: replace `range` (UTF-16) with `replacement` and put the caret at `caret`.
public struct ComposerEdit: Equatable, Sendable {
    public var range: Range<Int>
    public var replacement: String
    public var caret: Int

    /// Inserting `item` for `query` in `text`: the query's token is replaced, and a space follows unless one is already
    /// there.
    static func inserting(_ item: CompletionItem, for query: CompletionQuery, in text: String) -> ComposerEdit {
        let units = Array(text.utf16)
        let next = query.range.upperBound < units.count ? units[query.range.upperBound] : nil
        let followedBySpace = next.flatMap(Unicode.Scalar.init).map(\.properties.isWhitespace) ?? false
        let replacement = item.insertion + (followedBySpace ? "" : " ")
        let caret = query.range.lowerBound + replacement.utf16.count + (followedBySpace ? 1 : 0)
        return ComposerEdit(range: query.range, replacement: replacement, caret: caret)
    }
}
