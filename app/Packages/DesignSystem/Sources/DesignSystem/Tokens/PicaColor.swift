import SwiftUI

/// A color token with one value per appearance: light or dark, each at standard or increased contrast.
public struct PicaColor: ShapeStyle, Sendable, Equatable {
    public let light: RGB
    public let dark: RGB
    public let lightIncreasedContrast: RGB
    public let darkIncreasedContrast: RGB

    public init(light: RGB, dark: RGB, lightIncreasedContrast: RGB? = nil, darkIncreasedContrast: RGB? = nil) {
        self.light = light
        self.dark = dark
        self.lightIncreasedContrast = lightIncreasedContrast ?? light
        self.darkIncreasedContrast = darkIncreasedContrast ?? dark
    }

    public func rgb(for appearance: Appearance) -> RGB {
        switch appearance {
        case .light: light
        case .dark: dark
        case .lightIncreasedContrast: lightIncreasedContrast
        case .darkIncreasedContrast: darkIncreasedContrast
        }
    }

    public func resolve(in environment: EnvironmentValues) -> Color.Resolved {
        rgb(for: Appearance(environment)).resolved
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
public struct RGB: Sendable, Equatable, CustomStringConvertible {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(_ hex: UInt32) {
        red = Double((hex >> 16) & 0xFF) / 255
        green = Double((hex >> 8) & 0xFF) / 255
        blue = Double(hex & 0xFF) / 255
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
