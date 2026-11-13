import SwiftUI

/// Brand colors sampled from `docs/Magpie Glass Icon.png` (PLAN.md §7.3). Use `Palette` roles in views;
/// these raw values are for brand artwork and the gradient pair.
public enum BrandColor {
    /// The magpie's black plumage.
    public static let ink = RGB(0x3E4251)
    /// The wing and tail.
    public static let slate = RGB(0x62859C)
    /// The white belly.
    public static let paper = RGB(0xFBF6F2)
    /// The open ring around the bird.
    public static let ring = RGB(0x9AA0B0)
    /// The two spark marks.
    public static let spark = RGB(0xA7B6C5)
    /// Periwinkle end of the backdrop gradient. Empty states and onboarding only.
    public static let gradientStart = RGB(0xC9D6EC)
    /// Peach end of the backdrop gradient. Empty states and onboarding only.
    public static let gradientEnd = RGB(0xFFE4D2)
}

/// Semantic color roles. Light values are built from the brand colors; dark and increased-contrast
/// values are chosen to keep text at WCAG AA (AAA under increased contrast), which a unit test checks.
public enum Palette {
    public static let background = PicaColor(
        light: BrandColor.paper, dark: RGB(0x1C1E26),
        lightIncreasedContrast: RGB(0xFFFFFF), darkIncreasedContrast: RGB(0x000000))
    public static let surface = PicaColor(
        light: RGB(0xFFFFFF), dark: RGB(0x262833),
        lightIncreasedContrast: RGB(0xFFFFFF), darkIncreasedContrast: RGB(0x14151B))
    public static let textPrimary = PicaColor(
        light: BrandColor.ink, dark: RGB(0xF2EEE9),
        lightIncreasedContrast: RGB(0x1A1C24), darkIncreasedContrast: RGB(0xFFFFFF))
    public static let textSecondary = PicaColor(
        light: RGB(0x50555F), dark: RGB(0xB9BDC8),
        lightIncreasedContrast: BrandColor.ink, darkIncreasedContrast: RGB(0xDADDE5))
    public static let border = PicaColor(
        light: RGB(0xDDD8D2), dark: RGB(0x3A3D4A),
        lightIncreasedContrast: BrandColor.ink, darkIncreasedContrast: RGB(0xC9CCD6))
    /// Interactive emphasis: primary buttons, links, selection. Derived from slate.
    public static let accent = PicaColor(
        light: RGB(0x46667C), dark: RGB(0x8FB2C9),
        lightIncreasedContrast: RGB(0x2B4558), darkIncreasedContrast: RGB(0xB9D4E6))
    /// Text and icons drawn on `accent`.
    public static let onAccent = PicaColor(
        light: RGB(0xFFFFFF), dark: RGB(0x1C1E26),
        lightIncreasedContrast: RGB(0xFFFFFF), darkIncreasedContrast: RGB(0x000000))
    /// The activity ring. Non-text, so it needs 3:1 against the background.
    public static let ring = PicaColor(
        light: RGB(0x7E8496), dark: RGB(0x8A90A0),
        lightIncreasedContrast: RGB(0x4A4F60), darkIncreasedContrast: RGB(0xC0C5D2))
    /// The activity sparks.
    public static let spark = PicaColor(
        light: BrandColor.slate, dark: BrandColor.spark,
        lightIncreasedContrast: RGB(0x2B4558), darkIncreasedContrast: RGB(0xD3E0EA))
    public static let success = PicaColor(
        light: RGB(0x2E6B4C), dark: RGB(0x7FC8A0),
        lightIncreasedContrast: RGB(0x1F4F37), darkIncreasedContrast: RGB(0xA6E3C2))
    public static let warning = PicaColor(
        light: RGB(0x85570F), dark: RGB(0xE3B567),
        lightIncreasedContrast: RGB(0x6B4409), darkIncreasedContrast: RGB(0xF2CF8F))
    public static let danger = PicaColor(
        light: RGB(0xA3322F), dark: RGB(0xF08C86),
        lightIncreasedContrast: RGB(0x7F2220), darkIncreasedContrast: RGB(0xFFB3AE))
    /// Backdrop gradient pair. Empty states and onboarding only.
    public static let gradientStart = PicaColor(
        light: BrandColor.gradientStart, dark: RGB(0x262E40),
        lightIncreasedContrast: RGB(0xFFFFFF), darkIncreasedContrast: RGB(0x000000))
    public static let gradientEnd = PicaColor(
        light: BrandColor.gradientEnd, dark: RGB(0x3A2F2C),
        lightIncreasedContrast: RGB(0xFFFFFF), darkIncreasedContrast: RGB(0x000000))
}
