import Foundation
import Observation
import PicaProtocol

/// The General pane's values as the engine resolves them (`config.get`), and the writes it makes (`config.set`).
@Observable @MainActor
public final class SettingsStore {
    public private(set) var values: [String: ConfigValue] = [:]
    public private(set) var models: [ModelInfo] = []
    /// A refused write or a failed load, by key path.
    public private(set) var problems: [String: String] = [:]

    @ObservationIgnored private let backend: any ConfigBackend
    @ObservationIgnored let fields: [SettingsField]

    public init(backend: any ConfigBackend, fields: [SettingsField] = SettingsField.all) {
        self.backend = backend
        self.fields = fields
    }

    public func load() async {
        models = (try? await backend.models()) ?? models
        for field in fields {
            await reload(field.keyPath)
        }
    }

    public func value(_ keyPath: String) -> ConfigValue? {
        values[keyPath]
    }

    public func lock(_ keyPath: String) -> String? {
        values[keyPath].flatMap(ConfigLock.describe)
    }

    public func set(_ keyPath: String, to value: JSONValue) async {
        do {
            try await backend.set(keyPath, to: value)
            problems[keyPath] = nil
        } catch {
            problems[keyPath] = ConfigLock.message(error)
        }
        await reload(keyPath)
    }

    /// Removes the user's setting, so the default applies.
    public func reset(_ keyPath: String) async {
        await set(keyPath, to: .null)
    }

    private func reload(_ keyPath: String) async {
        do {
            values[keyPath] = try await backend.get(keyPath)
        } catch {
            problems[keyPath] = ConfigLock.message(error)
        }
    }
}
