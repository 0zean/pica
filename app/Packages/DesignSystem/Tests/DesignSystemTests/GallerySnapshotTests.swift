import SwiftUI
import Testing
@testable import DesignSystem

@MainActor
@Suite struct GallerySnapshotTests {
    /// The sparks hold still under Reduce Motion, which makes the rendering independent of the clock.
    private func renderGallery(_ appearance: Appearance) -> Bitmap {
        Snapshot.render(
            GalleryContent().padding(Spacing.xLarge).environment(\._accessibilityReduceMotion, true),
            width: 760, appearance: appearance)
    }

    @Test(arguments: Appearance.allCases)
    func galleryMatchesReference(_ appearance: Appearance) {
        Snapshot.assertMatchesReference(renderGallery(appearance), named: "gallery-\(appearance.snapshotName)")
    }

    @Test func eachAppearanceRendersDifferently() {
        let renders = Appearance.allCases.map(renderGallery)
        for (index, render) in renders.enumerated() {
            for other in renders[(index + 1)...] {
                #expect(render.differingPixelShare(from: other, channelTolerance: 0) > 0.01)
            }
        }
    }
}
