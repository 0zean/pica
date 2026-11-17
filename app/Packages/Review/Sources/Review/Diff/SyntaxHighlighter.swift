import Foundation

/// Where a line starts: in code, inside a block comment, or inside a string that spans lines (with its delimiter).
enum SyntaxState: Hashable, Sendable {
    case code
    case blockComment
    case string(delimiter: String)
}

enum SyntaxToken: Hashable, Sendable {
    case keyword
    case string
    case comment
    case number
}

struct SyntaxSpan: Hashable, Sendable {
    /// In UTF-8 offsets into the line.
    let range: Range<Int>
    let token: SyntaxToken
}

/// A small lexer per language family: keywords, strings, comments and numbers, which is what a diff needs to read
/// well. It knows nothing of grammar, so a keyword used as a name is still drawn as a keyword (docs/review.md).
struct SyntaxLanguage: Hashable, Sendable {
    let name: String
    let keywords: Set<String>
    let lineComments: [String]
    let blockComment: BlockDelimiters?
    /// Strings that end on the line they start on.
    let quotes: [String]
    /// Strings that may run over several lines, longest first.
    let longStrings: [String]

    struct BlockDelimiters: Hashable, Sendable {
        let open: String
        let close: String
    }

    // The delimiters as bytes, worked out once: the lexer compares them at every position.
    private let lineCommentBytes: [[UInt8]]
    private let blockOpenBytes: [UInt8]
    private let blockCloseBytes: [UInt8]
    private let quoteBytes: [[UInt8]]
    private let longStringBytes: [[UInt8]]
    /// The first byte of every delimiter: a line with none of them cannot change the state or hold a string or comment.
    private let delimiterStarts: Set<UInt8>

    init?(path: String) {
        let name = (path as NSString).lastPathComponent.lowercased()
        let ext = (name as NSString).pathExtension
        guard let language = Self.byExtension[ext] ?? Self.byName[name] else { return nil }
        self = language
    }

    private init(
        name: String, keywords: String, lineComments: [String], blockComment: BlockDelimiters?, quotes: [String],
        longStrings: [String] = []
    ) {
        self.name = name
        self.keywords = Set(keywords.split(separator: " ").map(String.init))
        self.lineComments = lineComments
        self.blockComment = blockComment
        self.quotes = quotes
        self.longStrings = longStrings
        lineCommentBytes = lineComments.map { Array($0.utf8) }
        blockOpenBytes = blockComment.map { Array($0.open.utf8) } ?? []
        blockCloseBytes = blockComment.map { Array($0.close.utf8) } ?? []
        quoteBytes = quotes.map { Array($0.utf8) }
        longStringBytes = longStrings.map { Array($0.utf8) }
        delimiterStarts = Set((lineCommentBytes + [blockOpenBytes] + quoteBytes + longStringBytes).compactMap(\.first))
    }

    /// The state the next line starts in.
    func state(after line: String, from state: SyntaxState) -> SyntaxState {
        if state == .code, !line.utf8.contains(where: delimiterStarts.contains) { return .code }
        return lex(Array(line.utf8), from: state, emit: nil)
    }

    func spans(of line: String, from state: SyntaxState) -> [SyntaxSpan] {
        var spans: [SyntaxSpan] = []
        _ = lex(Array(line.utf8), from: state) { spans.append($0) }
        return spans
    }

    private func lex(_ bytes: [UInt8], from start: SyntaxState, emit: ((SyntaxSpan) -> Void)?) -> SyntaxState {
        var state = start
        var index = 0
        while index < bytes.count {
            switch state {
            case .blockComment:
                let end = find(blockCloseBytes, in: bytes, from: index)
                emit?(SyntaxSpan(range: index..<(end ?? bytes.count), token: .comment))
                guard let end else { return .blockComment }
                index = end
                state = .code
            case .string(let delimiter):
                let end = closingQuote(Array(delimiter.utf8), in: bytes, from: index)
                emit?(SyntaxSpan(range: index..<(end ?? bytes.count), token: .string))
                guard let end else { return state }
                index = end
                state = .code
            case .code:
                if let next = token(in: bytes, at: index, emit: emit, state: &state) {
                    index = next
                } else {
                    index += 1
                }
            }
        }
        return state
    }

    /// Reads the token starting at `index`, if one does, and returns where it ends.
    private func token(in bytes: [UInt8], at index: Int, emit: ((SyntaxSpan) -> Void)?, state: inout SyntaxState) -> Int? {
        if lineCommentBytes.contains(where: { starts($0, bytes, at: index) }) {
            emit?(SyntaxSpan(range: index..<bytes.count, token: .comment))
            return bytes.count
        }
        if starts(blockOpenBytes, bytes, at: index) {
            state = .blockComment
            emit?(SyntaxSpan(range: index..<(index + blockOpenBytes.count), token: .comment))
            return index + blockOpenBytes.count
        }
        if let long = longStringBytes.first(where: { starts($0, bytes, at: index) }) {
            state = .string(delimiter: String(decoding: long, as: UTF8.self))
            emit?(SyntaxSpan(range: index..<(index + long.count), token: .string))
            return index + long.count
        }
        if let quote = quoteBytes.first(where: { starts($0, bytes, at: index) }) {
            let end = closingQuote(quote, in: bytes, from: index + quote.count) ?? bytes.count
            emit?(SyntaxSpan(range: index..<end, token: .string))
            return end
        }
        let byte = bytes[index]
        let previous = index > 0 ? bytes[index - 1] : nil
        if isDigit(byte), previous.map(isIdentifier) != true {
            let end = scan(bytes, from: index) { isIdentifier($0) || $0 == UInt8(ascii: ".") }
            emit?(SyntaxSpan(range: index..<end, token: .number))
            return end
        }
        if isIdentifierStart(byte), previous.map(isIdentifier) != true {
            let end = scan(bytes, from: index, while: isIdentifier)
            // Working out only the next line's state needs no keywords.
            if let emit, keywords.contains(String(decoding: bytes[index..<end], as: UTF8.self)) {
                emit(SyntaxSpan(range: index..<end, token: .keyword))
            }
            return end
        }
        return nil
    }

    /// The offset just past the closing delimiter, skipping backslash escapes; nil when the line ends first.
    private func closingQuote(_ delimiter: [UInt8], in bytes: [UInt8], from start: Int) -> Int? {
        var index = start
        while index < bytes.count {
            if bytes[index] == UInt8(ascii: "\\") {
                index += 2
            } else if starts(delimiter, bytes, at: index) {
                return index + delimiter.count
            } else {
                index += 1
            }
        }
        return nil
    }

    private func find(_ needle: [UInt8], in bytes: [UInt8], from start: Int) -> Int? {
        guard !needle.isEmpty else { return nil }
        var index = start
        while index + needle.count <= bytes.count {
            if starts(needle, bytes, at: index) { return index + needle.count }
            index += 1
        }
        return nil
    }

    private func starts(_ prefix: [UInt8], _ bytes: [UInt8], at index: Int) -> Bool {
        guard !prefix.isEmpty, index + prefix.count <= bytes.count else { return false }
        for offset in 0..<prefix.count where bytes[index + offset] != prefix[offset] {
            return false
        }
        return true
    }

    private func scan(_ bytes: [UInt8], from start: Int, while matches: (UInt8) -> Bool) -> Int {
        var index = start
        while index < bytes.count, matches(bytes[index]) {
            index += 1
        }
        return index
    }
}

private func isDigit(_ byte: UInt8) -> Bool {
    byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9")
}

private func isIdentifierStart(_ byte: UInt8) -> Bool {
    (byte >= UInt8(ascii: "a") && byte <= UInt8(ascii: "z")) || (byte >= UInt8(ascii: "A") && byte <= UInt8(ascii: "Z"))
        || byte == UInt8(ascii: "_") || byte >= 0x80
}

private func isIdentifier(_ byte: UInt8) -> Bool {
    isIdentifierStart(byte) || isDigit(byte)
}

extension SyntaxLanguage {
    private static let cBlock = BlockDelimiters(open: "/*", close: "*/")

    static let swift = SyntaxLanguage(
        name: "Swift",
        keywords: "actor any as associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate final for func guard if import in init inout internal is let mutating nil nonisolated open operator override private protocol public repeat rethrows return self Self some static struct subscript super switch throw throws true try typealias var weak where while",
        lineComments: ["//"], blockComment: cBlock, quotes: ["\""], longStrings: ["\"\"\""])
    static let typeScript = SyntaxLanguage(
        name: "TypeScript",
        keywords: "abstract any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface keyof let namespace never new null number object of private protected public readonly return satisfies set static string super switch this throw true try type typeof undefined unknown var void while yield",
        lineComments: ["//"], blockComment: cBlock, quotes: ["\"", "'"], longStrings: ["`"])
    static let json = SyntaxLanguage(name: "JSON", keywords: "true false null", lineComments: ["//"], blockComment: cBlock, quotes: ["\""])
    static let python = SyntaxLanguage(
        name: "Python",
        keywords: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield",
        lineComments: ["#"], blockComment: nil, quotes: ["\"", "'"], longStrings: ["\"\"\"", "'''"])
    static let ruby = SyntaxLanguage(
        name: "Ruby",
        keywords: "alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield",
        lineComments: ["#"], blockComment: nil, quotes: ["\"", "'"])
    static let go = SyntaxLanguage(
        name: "Go",
        keywords: "break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var",
        lineComments: ["//"], blockComment: cBlock, quotes: ["\"", "'"], longStrings: ["`"])
    static let rust = SyntaxLanguage(
        name: "Rust",
        keywords: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
        lineComments: ["//"], blockComment: cBlock, quotes: ["\""])
    static let cFamily = SyntaxLanguage(
        name: "C",
        keywords: "auto bool break case catch char class const constexpr continue default delete do double else enum extern false final float for goto if import inline int interface long namespace new nil NO null nullptr override package private protected public return self short signed sizeof static struct super switch template this throw throws true try typedef union unsigned using var virtual void volatile while YES",
        lineComments: ["//"], blockComment: cBlock, quotes: ["\"", "'"])
    static let kotlin = SyntaxLanguage(
        name: "Kotlin",
        keywords: "as break class continue data do else false for fun if in interface is null object override package private protected public return sealed super this throw true try typealias val var when while",
        lineComments: ["//"], blockComment: cBlock, quotes: ["\"", "'"], longStrings: ["\"\"\""])
    static let shell = SyntaxLanguage(
        name: "Shell",
        keywords: "case do done elif else esac exit export fi for function if in local readonly return set shift then unset until while",
        lineComments: ["#"], blockComment: nil, quotes: ["\"", "'"])
    static let yaml = SyntaxLanguage(name: "YAML", keywords: "true false null yes no on off", lineComments: ["#"], blockComment: nil, quotes: ["\"", "'"])
    static let css = SyntaxLanguage(
        name: "CSS", keywords: "important inherit initial none auto", lineComments: [], blockComment: cBlock, quotes: ["\"", "'"])

    private static let byExtension: [String: SyntaxLanguage] = [
        "swift": swift,
        "ts": typeScript, "tsx": typeScript, "mts": typeScript, "cts": typeScript,
        "js": typeScript, "jsx": typeScript, "mjs": typeScript, "cjs": typeScript,
        "json": json, "jsonc": json,
        "py": python,
        "rb": ruby,
        "go": go,
        "rs": rust,
        "c": cFamily, "h": cFamily, "cc": cFamily, "cpp": cFamily, "hpp": cFamily, "m": cFamily, "mm": cFamily,
        "java": cFamily, "cs": cFamily,
        "kt": kotlin, "kts": kotlin,
        "sh": shell, "bash": shell, "zsh": shell,
        "yml": yaml, "yaml": yaml, "toml": yaml,
        "css": css, "scss": css,
    ]

    private static let byName: [String: SyntaxLanguage] = [
        "makefile": shell, "dockerfile": shell, ".zshrc": shell, ".bashrc": shell, "gemfile": ruby, "podfile": ruby,
    ]
}
