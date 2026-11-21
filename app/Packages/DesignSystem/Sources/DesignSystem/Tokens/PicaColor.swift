import SwiftUI

/// A color token with one value per appearance: light or dark, each at standard or increased contrast.
/// A `Palette` role carries its `token`, so the theme in the environment (`\.picaTheme`) can replace its values.
public struct PicaColor: ShapeStyle, Sendable, Equatable {
    public let light: RGB
    public let dark: RGB
    public let lightIncreasedContrast: RGB
    public let darkIncreasedContrast: RGB
    /// The role a theme may override; nil for a color that is not a `Palette` role.
    public let token: ThemeToken?

    public init(
        light: RGB, dark: RGB, lightIncreasedContrast: RGB? = nil, darkIncreasedContrast: RGB? = nil,
        token: ThemeToken? = nil
    ) {
        self.light = light
        self.dark = dark
        self.lightIncreasedContrast = lightIncreasedContrast ?? light
        self.darkIncreasedContrast = darkIncreasedContrast ?? dark
        self.token = token
    }

    /// The built-in value, whatever the theme.
    public func rgb(for appearance: Appearance) -> RGB {
        switch appearance {
        case .light: light
        case .dark: dark
        case .lightIncreasedContrast: lightIncreasedContrast
        case .darkIncreasedContrast: darkIncreasedContrast
        }
    }

    /// The value `theme` gives this role, or the built-in one.
    public func rgb(for appearance: Appearance, in theme: Theme) -> RGB {
        (token.flatMap { theme.colors[$0] } ?? self).rgb(for: appearance)
    }

    /// The value drawn in `environment`, after its theme.
    public func rgb(in environment: EnvironmentValues) -> RGB {
        rgb(for: Appearance(environment), in: environment.picaTheme)
    }

    public func resolve(in environment: EnvironmentValues) -> Color.Resolved {
        rgb(in: environment).resolved
    }
}

public enum Appearance: CaseIterable, Sendable {
    case light
    case dark
    case lightIncreasedContrast
    case darkIncreasedContrast

    public init(_ environment: EnvironmentValues) {
        let increased = environment.colorSchemeContrast == .increased
        switch environment.colorScheme {
        case .dark: self = increased ? .darkIncreasedContrast : .dark
        default: self = increased ? .lightIncreasedContrast : .light
        }
    }
}

/// An sRGB color written as a 24-bit hex literal, e.g. `RGB(0x3E4251)`.
public struct RGB: Sendable, Equatable, Hashable, CustomStringConvertible {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(_ hex: UInt32) {
        red = Double((hex >> 16) & 0xFF) / 255
        green = Double((hex >> 8) & 0xFF) / 255
        blue = Double(hex & 0xFF) / 255
    }

    /// `#RRGGBB`, as theme files and config.jsonc write colors; nil for anything else.
    public init?(hexString: String) {
        guard hexString.count == 7, hexString.first == "#",
              hexString.dropFirst().allSatisfy(\.isHexDigit),
              let value = UInt32(hexString.dropFirst(), radix: 16)
        else { return nil }
        self.init(value)
    }

    /// Rounds each channel to 8 bits, as a hex literal would.
    public init(red: Double, green: Double, blue: Double) {
        func byte(_ channel: Double) -> UInt32 { UInt32((min(max(channel, 0), 1) * 255).rounded()) }
        self.init(byte(red) << 16 | byte(green) << 8 | byte(blue))
    }

    public var color: Color { Color(.sRGB, red: red, green: green, blue: blue) }

    var resolved: Color.Resolved {
        Color.Resolved(colorSpace: .sRGB, red: Float(red), green: Float(green), blue: Float(blue))
    }

    /// WCAG 2.x relative luminance.
    public var luminance: Double {
        func linear(_ channel: Double) -> Double {
            channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    /// WCAG 2.x contrast ratio, from 1 to 21.
    public func contrast(with other: RGB) -> Double {
        let lighter = max(luminance, other.luminance)
        let darker = min(luminance, other.luminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    public var description: String {
        String(format: "#%02X%02X%02X", Int(red * 255 + 0.5), Int(green * 255 + 0.5), Int(blue * 255 + 0.5))
    }
}
