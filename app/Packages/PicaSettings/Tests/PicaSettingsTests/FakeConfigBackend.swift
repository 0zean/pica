import Foundation
import PicaProtocol
@testable import PicaSettings

/// A user layer in memory over fixed defaults, with keys a managed policy may lock.
final class FakeConfigBackend: ConfigBackend, @unchecked Sendable {
    struct Refused: Error {}

    private let lock = NSLock()
    private var user: [String: JSONValue] = [:]
    private let defaults: [String: JSONValue]
    private let locked: [String: JSONValue]
    let policy: String?

    init(defaults: [String: JSONValue] = [:], locked: [String: JSONValue] = [:], policy: String? = nil) {
        self.defaults = defaults
        self.locked = locked
        self.policy = policy
    }

    var userLayer: [String: JSONValue] { lock.withLock { user } }

    func get(_ keyPath: String) async throws -> ConfigValue {
        lock.withLock {
            if keyPath == "keybindings" {
                let prefix = "keybindings."
                var entries: [String: JSONValue] = [:]
                for (key, value) in user where key.hasPrefix(prefix) { entries[String(key.dropFirst(prefix.count))] = value }
                return ConfigValue(keyPath: keyPath, value: .object(entries), layer: entries.isEmpty ? .default : .user,
                    locked: locked[keyPath] != nil, lockedBy: locked[keyPath] != nil ? policy : nil)
            }
            if let value = locked[keyPath] {
                return ConfigValue(keyPath: keyPath, value: value, layer: .managed, locked: true, lockedBy: policy)
            }
            if let value = user[keyPath] { return ConfigValue(keyPath: keyPath, value: value, layer: .user, locked: false) }
            return ConfigValue(keyPath: keyPath, value: defaults[keyPath] ?? .null, layer: .default, locked: false)
        }
    }

    func set(_ keyPath: String, to value: JSONValue) async throws {
        try lock.withLock {
            if locked[keyPath] != nil || locked.keys.contains(where: { keyPath.hasPrefix("\($0).") }) { throw Refused() }
            user[keyPath] = value == .null ? nil : value
        }
    }

    func models() async throws -> [ModelInfo] {
        [ModelInfo(id: "model-a", name: "Model A", prices: nil, allowedByPolicy: true)]
    }
}
