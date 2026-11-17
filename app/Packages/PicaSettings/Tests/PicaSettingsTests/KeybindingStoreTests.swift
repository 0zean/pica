import PicaProtocol
import Testing
@testable import PicaSettings

@MainActor
@Suite struct KeybindingStoreTests {
    /// A-14 verify (store half): a rebound shortcut is written to config and is what a new store reads back.
    @Test func reboundShortcutPersists() async throws {
        let backend = FakeConfigBackend()
        let store = KeybindingStore(backend: backend)
        await store.load()
        #expect(store.shortcut(for: .toggleInspector) == Shortcut("cmd+alt+i"))
        await store.rebind(.toggleInspector, to: Shortcut("ctrl+cmd+j"))
        #expect(backend.userLayer["keybindings.toggleInspector"] == .string("ctrl+cmd+j"))

        let reopened = KeybindingStore(backend: backend)
        await reopened.load()
        #expect(reopened.shortcut(for: .toggleInspector) == Shortcut("ctrl+cmd+j"))
        #expect(reopened.isCustomized(.toggleInspector))
    }

    @Test func clearingAndResetting() async {
        let backend = FakeConfigBackend()
        let store = KeybindingStore(backend: backend)
        await store.rebind(.showCommandPalette, to: nil)
        #expect(store.shortcut(for: .showCommandPalette) == nil)
        #expect(backend.userLayer["keybindings.showCommandPalette"] == .string(""))
        await store.reset(.showCommandPalette)
        #expect(store.shortcut(for: .showCommandPalette) == Shortcut("cmd+k"))
        #expect(backend.userLayer["keybindings.showCommandPalette"] == nil)
        await store.rebind(.toggleSidebar, to: Shortcut("cmd+ctrl+s"))
        #expect(backend.userLayer["keybindings.toggleSidebar"] == nil, "the default is not written")
    }

    @Test func refusesAShortcutAnotherActionHas() async {
        let backend = FakeConfigBackend()
        let store = KeybindingStore(backend: backend)
        await store.rebind(.toggleInspector, to: Shortcut("cmd+k"))
        #expect(store.shortcut(for: .toggleInspector) == Shortcut("cmd+alt+i"))
        #expect(store.problem?.contains("Show Command Palette") == true)
        #expect(backend.userLayer.isEmpty)
        await store.rebind(.toggleInspector, to: Shortcut("j"))
        #expect(store.problem?.contains("needs") == true)
    }

    @Test func ignoresUnknownActionsAndUnreadableShortcuts() async throws {
        let backend = FakeConfigBackend()
        try await backend.set("keybindings.noSuchAction", to: .string("cmd+j"))
        try await backend.set("keybindings.toggleSidebar", to: .string("cmd+nonsense"))
        let store = KeybindingStore(backend: backend)
        await store.load()
        #expect(store.ignored == ["noSuchAction", "toggleSidebar"])
        #expect(store.shortcut(for: .toggleSidebar) == Shortcut("cmd+ctrl+s"))
    }

    @Test func aLockedKeybindingsKeyIsNamed() async {
        let store = KeybindingStore(backend: FakeConfigBackend(locked: ["keybindings": .object([:])], policy: "acme"))
        await store.load()
        #expect(store.lock == "Locked by managed policy “acme”")
    }
}
