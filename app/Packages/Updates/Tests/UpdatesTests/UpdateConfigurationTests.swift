import Foundation
import Testing
@testable import Updates

@Suite struct UpdateConfigurationTests {
    private let feed = "https://updates.example.com/appcast.xml"

    @Test func enabledWithFeedAndKey() {
        let configuration = UpdateConfiguration(infoDictionary: ["SUFeedURL": feed, "SUPublicEDKey": "abc="])
        #expect(configuration.isEnabled)
        #expect(configuration.feedURL == URL(string: feed))
        #expect(configuration.publicKey == "abc=")
    }

    @Test func disabledWithoutKey() {
        #expect(!UpdateConfiguration(infoDictionary: ["SUFeedURL": feed]).isEnabled)
        // A release built without the key leaves the build setting empty in Info.plist.
        #expect(!UpdateConfiguration(infoDictionary: ["SUFeedURL": feed, "SUPublicEDKey": " "]).isEnabled)
    }

    @Test func disabledWithoutFeed() {
        #expect(!UpdateConfiguration(infoDictionary: ["SUPublicEDKey": "abc="]).isEnabled)
        #expect(!UpdateConfiguration(infoDictionary: ["SUFeedURL": "", "SUPublicEDKey": "abc="]).isEnabled)
    }
}
