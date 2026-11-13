import XCTest

final class GalleryAccessibilityTests: XCTestCase {
    /// Audits the gallery one screenful at a time, since the audit only sees what is on screen.
    /// Issues outside the gallery's scroll view (menu bar, title bar, window frame) belong to the
    /// system chrome, not the design system, so they are left out.
    @MainActor
    func testGalleryPassesTheAccessibilityAudit() throws {
        let app = XCUIApplication()
        app.launch()
        let gallery = app.scrollViews["ComponentGallery"]
        XCTAssertTrue(gallery.waitForExistence(timeout: 10))
        let galleryFrame = gallery.frame

        for _ in 0..<4 {
            try app.performAccessibilityAudit { issue in
                guard let element = issue.element, galleryFrame.contains(element.frame) else { return true }
                XCTFail("Accessibility audit: \(issue.compactDescription). \(issue.detailedDescription) Element: \(element.elementType.rawValue) \"\(element.label)\" \(element.frame)")
                return true
            }
            gallery.scroll(byDeltaX: 0, deltaY: -galleryFrame.height * 0.8)
        }
        XCTAssertTrue(app.staticTexts["No sessions yet"].isHittable, "the audit passes did not reach the end of the gallery")
    }
}
