import DesignSystem
import EngineClient
import Foundation
import Observation
import PicaProtocol

/// config.jsonc's `appearance` keys and the theme files they choose from (docs/themes.md). The app applies `theme`
/// and `density` to every window. Reloads on each connection to the engine and when Settings ▸ Appearance opens.
@Observable @MainActor
public final class AppearanceStore {
    public static let themeKey = "appearance.theme"
    public static let densityKey = "appearance.density"
    public static let accentKey = "appearance.accent"
    static let keys = [themeKey, densityKey, accentKey]

    /// What config.jsonc names, which may be a theme that is missing or invalid.
    public private(set) var themeId = Theme.pica.id
    public private(set) var density = Density.regular
    /// config.jsonc's accent, over the theme's.
    public private(set) var accent: RGB?
    public private(set) var library = ThemeLibrary.builtIn
    /// The managed policy's lock line, by key path.
    public private(set) var locks: [String: String] = [:]
    /// Which layer set each key; a `.user` key can go back to its default.
    public private(set) var layers: [String: ConfigLayer] = [:]
    /// A refused write or a failed load, by key path.
    public private(set) var problems: [String: String] = [:]

    @ObservationIgnored private let backend: any ConfigBackend
    @ObservationIgnored private let themesDirectory: URL
    @ObservationIgnored private var following: Task<Void, Never>?

    public init(backend: any ConfigBackend, themesDirectory: URL) {
        self.backend = backend
        self.themesDirectory = themesDirectory
    }

    /// The theme every window draws with: the chosen one, else the built-in one, with the accent over it.
    public var theme: Theme {
        let base = library.theme(id: themeId) ?? .pica
        return accent.map(base.withAccent) ?? base
    }

    /// Set when config.jsonc names a theme that has no valid file, so the built-in one is drawn instead.
    public var missingTheme: String? {
        library.theme(id: themeId) == nil ? themeId : nil
    }

    public var directory: URL { themesDirectory }

    /// Follows the engine's connection, loading on each connect. Calling it again does nothing.
    public func start(client: EngineClient) {
        guard following == nil else { return }
        following = Task {
            for await state in await client.connectionStates() {
                if case .connected = state { await self.load() }
            }
        }
    }

    public func load() async {
        library = ThemeLibrary.load(from: themesDirectory)
        for key in Self.keys {
            await reload(key)
        }
    }

    public func setTheme(_ id: String) async {
        await set(Self.themeKey, to: id == Theme.pica.id ? .null : .string(id))
    }

    public func setDensity(_ density: Density) async {
        await set(Self.densityKey, to: density == .regular ? .null : .string(density.rawValue))
    }

    /// nil goes back to the theme's accent.
    public func setAccent(_ accent: RGB?) async {
        await set(Self.accentKey, to: accent.map { .string($0.description) } ?? .null)
    }

    /// Removes the user's setting, so the default applies.
    public func reset(_ keyPath: String) async {
        await set(keyPath, to: .null)
    }

    private func set(_ keyPath: String, to value: JSONValue) async {
        do {
            try await backend.set(keyPath, to: value)
            problems[keyPath] = nil
        } catch {
            problems[keyPath] = ConfigLock.message(error)
        }
        await reload(keyPath)
    }

    private func reload(_ keyPath: String) async {
        let value: ConfigValue
        do {
            value = try await backend.get(keyPath)
        } catch {
            problems[keyPath] = ConfigLock.message(error)
            return
        }
        locks[keyPath] = ConfigLock.describe(value)
        layers[keyPath] = value.layer
        switch keyPath {
        case Self.themeKey:
            themeId = value.value.stringValue ?? Theme.pica.id
        case Self.densityKey:
            density = value.value.stringValue.flatMap(Density.init(rawValue:)) ?? .regular
        case Self.accentKey:
            accent = value.value.stringValue.flatMap(RGB.init(hexString:))
        default:
            break
        }
    }
}
