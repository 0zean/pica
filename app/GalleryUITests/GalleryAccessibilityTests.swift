import XCTest

final class GalleryAccessibilityTests: XCTestCase {
    @MainActor
    func testGalleryPassesTheAccessibilityAudit() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
        try app.performAccessibilityAudit { issue in
            let element = issue.element.map { "\($0.elementType) \"\($0.label)\" \($0.frame)" } ?? "no element"
            XCTFail("Accessibility audit: \(issue.compactDescription). \(issue.detailedDescription) Element: \(element)")
            return true
        }
    }
}
