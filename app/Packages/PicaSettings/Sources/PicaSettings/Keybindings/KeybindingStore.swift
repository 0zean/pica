import EngineClient
import Foundation
import Observation
import PicaProtocol

/// The shortcut each action has: its default, unless config.jsonc's `keybindings` says otherwise (docs/settings.md).
/// Reloads on each connection to the engine, and writes a change with `config.set` before showing it.
@Observable @MainActor
public final class KeybindingStore {
    /// The user's settings by action: a shortcut, or nil for one they cleared.
    public private(set) var overrides: [ActionID: Shortcut?] = [:]
    /// Set when a managed policy locks `keybindings`; the editor is then read-only.
    public private(set) var lock: String?
    /// The last change that was refused, shown in the editor.
    public private(set) var problem: String?
    /// `keybindings` entries this version of Pica does not know or cannot read; kept in the file, otherwise ignored.
    public private(set) var ignored: [String] = []
    public private(set) var hasLoaded = false

    @ObservationIgnored private let backend: any ConfigBackend
    @ObservationIgnored private var following: Task<Void, Never>?

    public init(backend: any ConfigBackend) {
        self.backend = backend
    }

    public func shortcut(for id: ActionID) -> Shortcut? {
        if let override = overrides[id] { return override }
        return ActionCatalog.definition(id).defaultShortcut
    }

    public func isCustomized(_ id: ActionID) -> Bool {
        overrides[id] != nil
    }

    /// The other action that already has `shortcut`, if any.
    public func conflict(for shortcut: Shortcut, excluding id: ActionID) -> ActionID? {
        ActionID.allCases.first { $0 != id && self.shortcut(for: $0) == shortcut }
    }

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
        do {
            apply(try await backend.get("keybindings"))
            hasLoaded = true
        } catch {
            problem = ConfigLock.message(error)
        }
    }

    /// Gives `id` a shortcut, or none for nil. Refused when another action has it.
    public func rebind(_ id: ActionID, to shortcut: Shortcut?) async {
        if let shortcut {
            guard shortcut.isUsable else {
                problem = "\(shortcut.displayString) needs ⌘, ⌃ or ⌥."
                return
            }
            if let other = conflict(for: shortcut, excluding: id) {
                problem = "\(shortcut.displayString) is already used by \(ActionCatalog.definition(other).title)."
                return
            }
        }
        if shortcut == ActionCatalog.definition(id).defaultShortcut {
            await reset(id)
            return
        }
        await write(id, .string(shortcut?.description ?? "")) { $0.overrides[id] = .some(shortcut) }
    }

    /// Goes back to the default shortcut.
    public func reset(_ id: ActionID) async {
        await write(id, .null) { $0.overrides[id] = nil }
    }

    private func write(_ id: ActionID, _ value: JSONValue, then change: (KeybindingStore) -> Void) async {
        do {
            try await backend.set("keybindings.\(id.rawValue)", to: value)
            change(self)
            problem = nil
        } catch {
            problem = ConfigLock.message(error)
        }
    }

    private func apply(_ value: ConfigValue) {
        lock = ConfigLock.describe(value)
        var overrides: [ActionID: Shortcut?] = [:]
        var ignored: [String] = []
        if case .object(let entries) = value.value {
            for (name, entry) in entries.sorted(by: { $0.key < $1.key }) {
                guard let id = ActionID(rawValue: name), case .string(let text) = entry else {
                    ignored.append(name)
                    continue
                }
                if text.isEmpty {
                    overrides[id] = .some(nil)
                } else if let shortcut = Shortcut(text) {
                    overrides[id] = .some(shortcut)
                } else {
                    ignored.append(name)
                }
            }
        }
        self.overrides = overrides
        self.ignored = ignored
    }
}
