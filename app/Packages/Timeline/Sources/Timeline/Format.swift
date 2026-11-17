import Foundation
import PicaProtocol

/// How the timeline writes numbers, durations and raw JSON.
enum Format {
    static func credits(_ credits: Credits) -> String {
        credits.formatted(.number.precision(.fractionLength(0...2)))
    }

    /// 950, 12.3K, 1.2M.
    static func tokens(_ count: Int) -> String {
        count.formatted(.number.notation(.compactName).precision(.significantDigits(1...3)))
    }

    /// 0.8 s, 12 s, 3 min 5 s.
    static func duration(milliseconds: Int) -> String {
        if milliseconds < 10_000 {
            return "\((Double(milliseconds) / 1000).formatted(.number.precision(.fractionLength(1)))) s"
        }
        let seconds = milliseconds / 1000
        return seconds < 60 ? "\(seconds) s" : "\(seconds / 60) min \(seconds % 60) s"
    }

    static func bytes(_ count: Int) -> String {
        count.formatted(.byteCount(style: .file))
    }

    static func percent(_ fraction: Double) -> String {
        fraction.formatted(.percent.precision(.fractionLength(0)))
    }

    static func json(_ value: JSONValue) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    /// A tool's arguments on one line, for its collapsed row: the first string argument, else the JSON.
    static func argumentSummary(_ arguments: [String: JSONValue]) -> String {
        for key in ["path", "command", "pattern", "query", "url"] {
            if case .string(let value)? = arguments[key] { return value }
        }
        for key in arguments.keys.sorted() {
            if case .string(let value)? = arguments[key] { return value }
        }
        guard !arguments.isEmpty else { return "" }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(arguments)).map { String(decoding: $0, as: UTF8.self) } ?? ""
    }
}
