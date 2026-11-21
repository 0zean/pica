import SwiftUI
import Testing
@testable import DesignSystem
import DesignSystemTestSupport

/// X-01: the gallery at each density, and with a custom accent (docs/themes.md).
@MainActor
@Suite struct ThemeSnapshotTests {
    private let location = SnapshotLocation(testFile: #filePath)
    private static let customAccent = RGB(0xB4533A)

    /// The sparks hold still under Reduce Motion, which makes the rendering independent of the clock.
    private func renderGallery(theme: Theme = .pica, density: Density, appearance: Appearance = .light) -> Bitmap {
        Snapshot.render(
            GalleryContent()
                .padding(density.spacing(Spacing.xLarge))
                .picaAppearance(theme: theme, density: density)
                .environment(\._accessibilityReduceMotion, true),
            width: 760, appearance: appearance)
    }

    @Test(arguments: Density.allCases)
    func densityMatchesReference(_ density: Density) {
        Snapshot.assertMatchesReference(renderGallery(density: density), named: "gallery-density-\(density.rawValue)", in: location)
    }

    @Test func compactIsShorterAndComfortableTaller() {
        let heights = Density.allCases.map { renderGallery(density: $0).height }
        #expect(heights == heights.sorted())
        #expect(Set(heights).count == Density.allCases.count, "\(heights)")
    }

    @Test(arguments: [Appearance.light, .dark])
    func customAccentMatchesReference(_ appearance: Appearance) {
        let bitmap = renderGallery(theme: Theme.pica.withAccent(Self.customAccent), density: .regular, appearance: appearance)
        Snapshot.assertMatchesReference(bitmap, named: "gallery-accent-custom-\(appearance.snapshotName)", in: location)
    }

    @Test func customAccentChangesOnlyAccentedPixels() {
        let standard = renderGallery(density: .regular)
        let custom = renderGallery(theme: Theme.pica.withAccent(Self.customAccent), density: .regular)
        let share = custom.differingPixelShare(from: standard, channelTolerance: 0)
        #expect(share > 0.001, "the accent did not change the gallery")
        #expect(share < 0.1, "a custom accent changed more than accented parts: \(share)")
    }
}
