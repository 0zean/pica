import Foundation

/// What the app's Info.plist says about updates (docs/distribution.md). A build without Sparkle's public EdDSA key, or
/// without a feed, cannot verify an update, so it never checks for one.
public struct UpdateConfiguration: Equatable, Sendable {
    public var feedURL: URL?
    public var publicKey: String?

    public init(feedURL: URL?, publicKey: String?) {
        self.feedURL = feedURL
        self.publicKey = publicKey
    }

    public init(infoDictionary: [String: Any]) {
        let feed = (infoDictionary["SUFeedURL"] as? String).flatMap(Self.nonEmpty)
        self.init(
            feedURL: feed.flatMap(URL.init(string:)),
            publicKey: (infoDictionary["SUPublicEDKey"] as? String).flatMap(Self.nonEmpty))
    }

    public var isEnabled: Bool { feedURL != nil && publicKey != nil }

    private static func nonEmpty(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }
}
