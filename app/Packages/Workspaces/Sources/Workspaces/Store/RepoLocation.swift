import Foundation

/// What the user typed into Add Repository: a folder on this Mac, registered in place, or a remote URL, cloned into
/// Pica's managed directory (PLAN.md §6).
public enum RepoLocation: Equatable, Sendable {
    case path(String)
    case url(String)

    /// nil for empty input, or a relative path, which has nothing to be relative to.
    public init?(_ input: String, homeDirectory: String = NSHomeDirectory()) {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if text.hasPrefix("/") {
            self = .path(Self.standardized(text))
        } else if text == "~" || text.hasPrefix("~/") {
            self = .path(Self.standardized(homeDirectory + text.dropFirst()))
        } else if text.contains("://") || Self.isScpLike(text) {
            self = .url(text)
        } else {
            return nil
        }
    }

    /// `git@host:org/repo`, the form git accepts without a scheme.
    private static func isScpLike(_ text: String) -> Bool {
        guard let colon = text.firstIndex(of: ":"), let at = text.firstIndex(of: "@"), at < colon else { return false }
        return !text[text.index(after: colon)...].isEmpty
    }

    private static func standardized(_ path: String) -> String {
        let standardized = (path as NSString).standardizingPath
        return standardized.isEmpty ? "/" : standardized
    }
}
