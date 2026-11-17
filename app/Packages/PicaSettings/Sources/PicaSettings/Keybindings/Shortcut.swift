import AppKit
import SwiftUI

/// A key and its modifiers, written in config.jsonc as `ctrl+alt+shift+cmd+key` (any order is read; this order is
/// written). Keys are one character, or a name: return, escape, tab, space, delete, up, down, left, right.
public struct Shortcut: Hashable, Sendable, CustomStringConvertible {
    public enum Modifier: String, CaseIterable, Sendable {
        case ctrl, alt, shift, cmd

        var symbol: String {
            switch self {
            case .ctrl: "⌃"
            case .alt: "⌥"
            case .shift: "⇧"
            case .cmd: "⌘"
            }
        }
    }

    public let key: String
    public let modifiers: Set<Modifier>

    static let namedKeys: [String: (symbol: String, equivalent: KeyEquivalent)] = [
        "return": ("↩", .return), "escape": ("⎋", .escape), "tab": ("⇥", .tab), "space": ("Space", .space),
        "delete": ("⌫", .delete), "up": ("↑", .upArrow), "down": ("↓", .downArrow), "left": ("←", .leftArrow),
        "right": ("→", .rightArrow),
    ]

    public init?(key: String, modifiers: Set<Modifier>) {
        let key = key.lowercased()
        guard key.count == 1 || Self.namedKeys[key] != nil, key != "+" else { return nil }
        self.key = key
        self.modifiers = modifiers
    }

    /// Reads the config form; nil for anything else, including an empty string.
    public init?(_ text: String) {
        var parts = text.lowercased().split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        guard let key = parts.popLast(), !key.isEmpty else { return nil }
        var modifiers: Set<Modifier> = []
        for part in parts {
            guard let modifier = Modifier(rawValue: part == "option" ? "alt" : part == "command" ? "cmd" : part),
                  modifiers.insert(modifier).inserted
            else { return nil }
        }
        self.init(key: key, modifiers: modifiers)
    }

    /// The config form.
    public var description: String {
        (Modifier.allCases.filter(modifiers.contains).map(\.rawValue) + [key]).joined(separator: "+")
    }

    /// As menus show it: ⌃⌥⇧⌘K.
    public var displayString: String {
        Modifier.allCases.filter(modifiers.contains).map(\.symbol).joined()
            + (Self.namedKeys[key]?.symbol ?? key.uppercased())
    }

    /// A shortcut that typing text cannot set off: it has ⌘, ⌃ or ⌥, or is a named key other than space and delete.
    public var isUsable: Bool {
        !modifiers.isDisjoint(with: [.cmd, .ctrl, .alt]) || ["escape", "up", "down", "left", "right"].contains(key)
    }

    public var keyEquivalent: KeyEquivalent {
        Self.namedKeys[key]?.equivalent ?? KeyEquivalent(Character(key))
    }

    public var eventModifiers: EventModifiers {
        var flags: EventModifiers = []
        if modifiers.contains(.cmd) { flags.insert(.command) }
        if modifiers.contains(.ctrl) { flags.insert(.control) }
        if modifiers.contains(.alt) { flags.insert(.option) }
        if modifiers.contains(.shift) { flags.insert(.shift) }
        return flags
    }

    public var keyboardShortcut: KeyboardShortcut {
        KeyboardShortcut(keyEquivalent, modifiers: eventModifiers)
    }

    /// The shortcut a key press makes, or nil for a key that has none (a modifier alone, a function key).
    @MainActor
    public init?(event: NSEvent) {
        var modifiers: Set<Modifier> = []
        let flags = event.modifierFlags
        if flags.contains(.command) { modifiers.insert(.cmd) }
        if flags.contains(.control) { modifiers.insert(.ctrl) }
        if flags.contains(.option) { modifiers.insert(.alt) }
        if flags.contains(.shift) { modifiers.insert(.shift) }
        let named: [UInt16: String] = [
            36: "return", 53: "escape", 48: "tab", 49: "space", 51: "delete", 126: "up", 125: "down", 123: "left", 124: "right",
        ]
        if let name = named[event.keyCode] {
            self.init(key: name, modifiers: modifiers)
            return
        }
        // Without modifiers, so ⇧⌘] is `shift+cmd+]` and ⌥⌘I is not `alt+cmd+ˆ`.
        guard let characters = event.characters(byApplyingModifiers: []), characters.count == 1,
              let scalar = characters.unicodeScalars.first, !CharacterSet.controlCharacters.contains(scalar),
              scalar.value < 0xF700
        else { return nil }
        self.init(key: characters, modifiers: modifiers)
    }
}
