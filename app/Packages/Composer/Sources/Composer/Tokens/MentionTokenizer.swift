import Foundation

/// A mention (`@name`, `@"name with spaces"`) or a skill (`/name`) in the composer's text. Ranges are in UTF-16 code
/// units, as `NSTextView` counts them.
public struct ComposerToken: Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case mention
        case skill
    }

    public var kind: Kind
    /// From the trigger character to the end of the token, closing quote included.
    public var range: Range<Int>
    /// The text after the trigger, without quotes.
    public var name: String

    public init(_ kind: Kind, _ range: Range<Int>, _ name: String) {
        self.kind = kind
        self.range = range
        self.name = name
    }
}

/// What the caret is in the middle of typing, for completions: the trigger, what has been typed after it, and the
/// range a chosen completion replaces.
public struct CompletionQuery: Equatable, Sendable {
    public var kind: ComposerToken.Kind
    /// Typed between the trigger (and an opening quote) and the caret.
    public var text: String
    /// From the trigger to the end of the token under the caret.
    public var range: Range<Int>

    public init(_ kind: ComposerToken.Kind, _ text: String, _ range: Range<Int>) {
        self.kind = kind
        self.text = text
        self.range = range
    }
}

/// Finds mentions and skills in composer text. The rules (docs/composer.md):
///
/// - `@` starts a mention at the start of the text, after whitespace, or after one of `( [ { < " '`. So `a@b.com`
///   and `` `@x` `` are text.
/// - An unquoted mention runs to whitespace or one of `, ; ! ? ( ) [ ] { } < > " ' `` ` `` @`; a trailing `.` or `:`
///   is punctuation, not part of the name. `@"…"` quotes a name with spaces and ends at the closing quote on the same
///   line. An empty name is text.
/// - `/` starts a skill at the start of a line (spaces and tabs before it are allowed). The name is letters, digits,
///   `-`, `_` and `.`, and must be followed by whitespace or the end, so `/usr/bin` is text.
public enum MentionTokenizer {
    public static func tokens(in text: String) -> [ComposerToken] {
        let units = Array(text.utf16)
        var tokens: [ComposerToken] = []
        var index = 0
        while index < units.count {
            let unit = units[index]
            if unit == at, startsMention(units, index), let token = mention(units, at: index) {
                tokens.append(token)
                index = token.range.upperBound
            } else if unit == slash, startsSkill(units, index), let token = skill(units, at: index) {
                tokens.append(token)
                index = token.range.upperBound
            } else {
                index += 1
            }
        }
        return tokens
    }

    /// The mention or skill the caret (a UTF-16 offset) is typing, if any.
    public static func activeQuery(in text: String, caret: Int) -> CompletionQuery? {
        let units = Array(text.utf16)
        guard caret >= 0, caret <= units.count else { return nil }
        return unquotedQuery(units, caret) ?? quotedQuery(units, caret) ?? skillQuery(units, caret)
    }

    // MARK: Mentions

    private static func mention(_ units: [UInt16], at start: Int) -> ComposerToken? {
        let bodyStart = start + 1
        if bodyStart < units.count, units[bodyStart] == quote {
            var end = bodyStart + 1
            while end < units.count, units[end] != quote, !isNewline(units[end]) { end += 1 }
            guard end < units.count, units[end] == quote, end > bodyStart + 1 else { return nil }
            return ComposerToken(.mention, start..<(end + 1), string(units[(bodyStart + 1)..<end]))
        }
        var end = bodyStart
        while end < units.count, isMentionBody(units[end]) { end += 1 }
        while end > bodyStart, units[end - 1] == period || units[end - 1] == colon { end -= 1 }
        guard end > bodyStart else { return nil }
        return ComposerToken(.mention, start..<end, string(units[bodyStart..<end]))
    }

    private static func startsMention(_ units: [UInt16], _ index: Int) -> Bool {
        guard index > 0 else { return true }
        let previous = units[index - 1]
        return isWhitespace(previous) || mentionOpeners.contains(previous)
    }

    private static func unquotedQuery(_ units: [UInt16], _ caret: Int) -> CompletionQuery? {
        var start = caret
        while start > 0, isMentionBody(units[start - 1]) { start -= 1 }
        guard start > 0, units[start - 1] == at, startsMention(units, start - 1) else { return nil }
        var end = caret
        while end < units.count, isMentionBody(units[end]) { end += 1 }
        return CompletionQuery(.mention, string(units[start..<caret]), (start - 1)..<end)
    }

    private static func quotedQuery(_ units: [UInt16], _ caret: Int) -> CompletionQuery? {
        var start = caret
        while start > 0, units[start - 1] != quote, !isNewline(units[start - 1]) { start -= 1 }
        guard start >= 2, units[start - 1] == quote, units[start - 2] == at, startsMention(units, start - 2) else { return nil }
        var end = caret
        while end < units.count, units[end] != quote, !isNewline(units[end]) { end += 1 }
        if end < units.count, units[end] == quote { end += 1 }
        return CompletionQuery(.mention, string(units[start..<caret]), (start - 2)..<end)
    }

    // MARK: Skills

    private static func skill(_ units: [UInt16], at start: Int) -> ComposerToken? {
        var end = start + 1
        while end < units.count, isSkillBody(units[end]) { end += 1 }
        guard end > start + 1, end == units.count || isWhitespace(units[end]) else { return nil }
        return ComposerToken(.skill, start..<end, string(units[(start + 1)..<end]))
    }

    private static func startsSkill(_ units: [UInt16], _ index: Int) -> Bool {
        var before = index
        while before > 0, units[before - 1] == space || units[before - 1] == tab { before -= 1 }
        return before == 0 || isNewline(units[before - 1])
    }

    private static func skillQuery(_ units: [UInt16], _ caret: Int) -> CompletionQuery? {
        var start = caret
        while start > 0, isSkillBody(units[start - 1]) { start -= 1 }
        guard start > 0, units[start - 1] == slash, startsSkill(units, start - 1) else { return nil }
        var end = caret
        while end < units.count, isSkillBody(units[end]) { end += 1 }
        guard end == units.count || isWhitespace(units[end]) else { return nil }
        return CompletionQuery(.skill, string(units[start..<caret]), (start - 1)..<end)
    }

    // MARK: Characters

    private static let at = UInt16(UInt8(ascii: "@"))
    private static let slash = UInt16(UInt8(ascii: "/"))
    private static let quote = UInt16(UInt8(ascii: "\""))
    private static let period = UInt16(UInt8(ascii: "."))
    private static let colon = UInt16(UInt8(ascii: ":"))
    private static let space = UInt16(UInt8(ascii: " "))
    private static let tab = UInt16(UInt8(ascii: "\t"))
    private static let mentionOpeners = Set("([{<\"'".utf16)
    private static let mentionStops = Set(",;!?()[]{}<>\"'`@".utf16)

    private static func isMentionBody(_ unit: UInt16) -> Bool {
        !isWhitespace(unit) && !mentionStops.contains(unit)
    }

    private static func isSkillBody(_ unit: UInt16) -> Bool {
        switch unit {
        case 0x30...0x39, 0x41...0x5A, 0x61...0x7A: true
        case UInt16(UInt8(ascii: "-")), UInt16(UInt8(ascii: "_")), period: true
        default: false
        }
    }

    private static func isNewline(_ unit: UInt16) -> Bool {
        unit == 0x0A || unit == 0x0D || unit == 0x2028 || unit == 0x2029
    }

    private static func isWhitespace(_ unit: UInt16) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return false }  // a surrogate, part of a non-space character
        return scalar.properties.isWhitespace
    }

    private static func string(_ units: ArraySlice<UInt16>) -> String {
        String(decoding: units, as: UTF16.self)
    }
}
