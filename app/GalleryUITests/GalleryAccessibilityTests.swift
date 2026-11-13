import XCTest

final class GalleryAccessibilityTests: XCTestCase {
    @MainActor
    func testGalleryPassesTheAccessibilityAudit() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
        try app.performAccessibilityAudit()
    }
}
