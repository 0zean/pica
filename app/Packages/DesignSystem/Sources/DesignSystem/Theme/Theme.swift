import SwiftUI

/// A `Palette` role a theme may give its own values (docs/themes.md). The raw value is the name theme files use.
public enum ThemeToken: String, CaseIterable, Sendable {
    case background
    case surface
    case textPrimary
    case textSecondary
    case border
    case accent
    case onAccent
    case ring
    case spark
    case success
    case warning
    case danger
    case gradientStart
    case gradientEnd
}

/// Values for some `Palette` roles; a role the theme leaves out keeps its built-in value.
public struct Theme: Equatable, Sendable, Identifiable {
    /// The built-in theme: every role at its `Palette` value.
    public static let pica = Theme(id: "pica", name: "Pica", colors: [:])

    /// The file name without `.jsonc`, which config.jsonc's `appearance.theme` names.
    public let id: String
    public let name: String
    public let colors: [ThemeToken: PicaColor]

    public init(id: String, name: String, colors: [ThemeToken: PicaColor]) {
        self.id = id
        self.name = name
        self.colors = colors
    }

    /// The theme with `accent` in every appearance, as config.jsonc's `appearance.accent` sets it. `onAccent`
    /// becomes whichever of white and the dark background reads better on it.
    public func withAccent(_ accent: RGB) -> Theme {
        var colors = colors
        colors[.accent] = PicaColor(light: accent, dark: accent)
        colors[.onAccent] = PicaColor(
            light: Self.onColor(for: accent, dark: Palette.onAccent.dark),
            dark: Self.onColor(for: accent, dark: Palette.onAccent.dark),
            lightIncreasedContrast: Self.onColor(for: accent, dark: RGB(0x000000)),
            darkIncreasedContrast: Self.onColor(for: accent, dark: RGB(0x000000)))
        return Theme(id: id, name: name, colors: colors)
    }

    private static func onColor(for fill: RGB, dark: RGB) -> RGB {
        let white = RGB(0xFFFFFF)
        return white.contrast(with: fill) >= dark.contrast(with: fill) ? white : dark
    }
}

extension EnvironmentValues {
    /// The theme `Palette` roles resolve through. Set with `picaAppearance(theme:density:)`.
    @Entry public var picaTheme: Theme = .pica
    /// How tightly components are spaced. Set with `picaAppearance(theme:density:)`.
    @Entry public var picaDensity: Density = .regular
}

extension View {
    /// Applies a theme and a density to everything inside: `Palette` roles, the controls' tint and size, and the
    /// minimum height of list rows.
    public func picaAppearance(theme: Theme, density: Density) -> some View {
        tint(Palette.accent)
            .controlSize(density.controlSize)
            .environment(\.defaultMinListRowHeight, density.minimumListRowHeight)
            .environment(\.picaDensity, density)
            .environment(\.picaTheme, theme)
    }
}
