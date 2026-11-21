import Foundation

/// A theme file is JSONC (docs/themes.md):
///
///     {
///       "name": "Harbor",
///       "colors": {
///         "accent": "#2F6F8F",
///         "background": { "light": "#FFFFFF", "dark": "#101318" }
///       }
///     }
///
/// Every key is checked, so a misspelt token is an error that names it rather than a color silently left out.
public enum ThemeFile {
    public static let fileExtension = "jsonc"

    private static let topLevelKeys: Set<String> = ["$schema", "name", "colors"]

    public static func parse(_ data: Data, id: String) throws(ThemeFileError) -> Theme {
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data, options: [.json5Allowed])
        } catch {
            throw .unreadable((error as NSError).userInfo[NSDebugDescriptionErrorKey] as? String ?? "not JSON")
        }
        guard let root = object as? [String: Any] else { throw .notAnObject }
        if let unknown = root.keys.sorted().first(where: { !topLevelKeys.contains($0) }) {
            throw .unknownKey(unknown)
        }
        let name: String
        switch root["name"] {
        case nil: name = id
        case let text as String where !text.trimmingCharacters(in: .whitespaces).isEmpty: name = text
        default: throw .invalidName
        }
        let colors: [String: Any]
        switch root["colors"] {
        case nil: colors = [:]
        case let object as [String: Any]: colors = object
        default: throw .colorsNotAnObject
        }
        var parsed: [ThemeToken: PicaColor] = [:]
        for key in colors.keys.sorted() {
            guard let token = ThemeToken(rawValue: key) else { throw .unknownToken(key) }
            parsed[token] = try color(colors[key] as Any, token: token)
        }
        return Theme(id: id, name: name, colors: parsed)
    }

    /// A string sets every appearance; an object sets some, the rest keeping the role's built-in value.
    private static func color(_ value: Any, token: ThemeToken) throws(ThemeFileError) -> PicaColor {
        if let text = value as? String {
            let rgb = try hex(text, at: token.rawValue)
            return PicaColor(light: rgb, dark: rgb)
        }
        guard let variants = value as? [String: Any] else {
            throw .invalidColor(token.rawValue, String(describing: value))
        }
        var rgb: [Appearance: RGB] = [:]
        for key in variants.keys.sorted() {
            guard let appearance = Appearance(themeKey: key) else { throw .unknownAppearance(token: token.rawValue, key: key) }
            guard let text = variants[key] as? String else {
                throw .invalidColor("\(token.rawValue).\(key)", String(describing: variants[key] ?? "null"))
            }
            rgb[appearance] = try hex(text, at: "\(token.rawValue).\(key)")
        }
        let builtIn = Palette.color(for: token)
        let light = rgb[.light] ?? builtIn.light
        let dark = rgb[.dark] ?? builtIn.dark
        return PicaColor(
            light: light, dark: dark,
            lightIncreasedContrast: rgb[.lightIncreasedContrast] ?? (rgb[.light] ?? builtIn.lightIncreasedContrast),
            darkIncreasedContrast: rgb[.darkIncreasedContrast] ?? (rgb[.dark] ?? builtIn.darkIncreasedContrast))
    }

    private static func hex(_ text: String, at path: String) throws(ThemeFileError) -> RGB {
        guard let rgb = RGB(hexString: text) else { throw .invalidColor(path, text) }
        return rgb
    }
}

public enum ThemeFileError: Error, Equatable, Sendable, CustomStringConvertible {
    case unreadable(String)
    case notAnObject
    case unknownKey(String)
    case invalidName
    case colorsNotAnObject
    case unknownToken(String)
    case unknownAppearance(token: String, key: String)
    case invalidColor(String, String)

    public var description: String {
        switch self {
        case .unreadable(let reason):
            "Not valid JSONC: \(reason)"
        case .notAnObject:
            "A theme file is an object with \"name\" and \"colors\"."
        case .unknownKey(let key):
            "Unknown key “\(key)”. A theme file has \"name\" and \"colors\"."
        case .invalidName:
            "\"name\" must be a non-empty string."
        case .colorsNotAnObject:
            "\"colors\" must be an object of tokens."
        case .unknownToken(let token):
            "Unknown token “\(token)”. Known tokens: \(ThemeToken.allCases.map(\.rawValue).joined(separator: ", "))."
        case .unknownAppearance(let token, let key):
            "Unknown appearance “\(key)” in “\(token)”. Use light, dark, lightIncreasedContrast or darkIncreasedContrast."
        case .invalidColor(let path, let value):
            "“\(path)” is \(value), not a color written #RRGGBB."
        }
    }
}

extension Appearance {
    /// The key a theme file uses for this appearance.
    public var themeKey: String {
        switch self {
        case .light: "light"
        case .dark: "dark"
        case .lightIncreasedContrast: "lightIncreasedContrast"
        case .darkIncreasedContrast: "darkIncreasedContrast"
        }
    }

    init?(themeKey: String) {
        guard let match = Appearance.allCases.first(where: { $0.themeKey == themeKey }) else { return nil }
        self = match
    }
}

extension Palette {
    /// The built-in value of `token`'s role.
    public static func color(for token: ThemeToken) -> PicaColor {
        switch token {
        case .background: background
        case .surface: surface
        case .textPrimary: textPrimary
        case .textSecondary: textSecondary
        case .border: border
        case .accent: accent
        case .onAccent: onAccent
        case .ring: ring
        case .spark: spark
        case .success: success
        case .warning: warning
        case .danger: danger
        case .gradientStart: gradientStart
        case .gradientEnd: gradientEnd
        }
    }
}
