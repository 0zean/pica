import Testing
@testable import DesignSystem

/// WCAG 2.x: 4.5:1 for text (7:1 under increased contrast), 3:1 for meaningful non-text marks.
@Suite struct ContrastTests {
    private static let textOnBackgrounds: [(String, PicaColor)] = [
        ("textPrimary", Palette.textPrimary), ("textSecondary", Palette.textSecondary),
        ("accent", Palette.accent), ("success", Palette.success),
        ("warning", Palette.warning), ("danger", Palette.danger),
    ]

    private func minimumTextContrast(_ appearance: Appearance) -> Double {
        switch appearance {
        case .light, .dark: 4.5
        case .lightIncreasedContrast, .darkIncreasedContrast: 7
        }
    }

    @Test(arguments: Appearance.allCases)
    func textRolesAreLegibleOnBackgroundAndSurface(_ appearance: Appearance) {
        for (name, text) in Self.textOnBackgrounds {
            for (backgroundName, background) in [("background", Palette.background), ("surface", Palette.surface)] {
                let ratio = text.rgb(for: appearance).contrast(with: background.rgb(for: appearance))
                #expect(ratio >= minimumTextContrast(appearance), "\(name) on \(backgroundName): \(ratio)")
            }
        }
    }

    @Test(arguments: Appearance.allCases)
    func onAccentIsLegibleOnFilledButtons(_ appearance: Appearance) {
        for (name, fill) in [("accent", Palette.accent), ("danger", Palette.danger)] {
            let ratio = Palette.onAccent.rgb(for: appearance).contrast(with: fill.rgb(for: appearance))
            #expect(ratio >= minimumTextContrast(appearance), "onAccent on \(name): \(ratio)")
        }
    }

    @Test(arguments: Appearance.allCases)
    func textIsLegibleOnTheBrandGradient(_ appearance: Appearance) {
        for stop in [Palette.gradientStart, Palette.gradientEnd] {
            let ratio = Palette.textPrimary.rgb(for: appearance).contrast(with: stop.rgb(for: appearance))
            #expect(ratio >= minimumTextContrast(appearance), "\(ratio)")
        }
    }

    @Test(arguments: Appearance.allCases)
    func activityMarkIsVisible(_ appearance: Appearance) {
        for (name, mark) in [("ring", Palette.ring), ("spark", Palette.spark), ("accent", Palette.accent)] {
            let ratio = mark.rgb(for: appearance).contrast(with: Palette.background.rgb(for: appearance))
            #expect(ratio >= 3, "\(name): \(ratio)")
        }
    }

    @Test func brandColorsAreTheSampledLogoValues() {
        #expect(BrandColor.ink.description == "#3E4251")
        #expect(BrandColor.slate.description == "#62859C")
        #expect(BrandColor.paper.description == "#FBF6F2")
        #expect(Palette.textPrimary.light == BrandColor.ink)
        #expect(Palette.background.light == BrandColor.paper)
    }
}
