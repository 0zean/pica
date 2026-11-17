import PicaProtocol
import Testing
@testable import PicaSettings

@MainActor
@Suite struct SettingsStoreTests {
    /// A-14 verify (store half): a key a managed policy locks says which policy, and a write to it is refused.
    @Test func lockedKeyNamesThePolicy() async {
        let backend = FakeConfigBackend(
            defaults: ["budget.sessionCredits": .number(300)], locked: ["budget.sessionCredits": .number(100)], policy: "acme")
        let store = SettingsStore(backend: backend)
        await store.load()
        #expect(store.value("budget.sessionCredits")?.value == .number(100))
        #expect(store.lock("budget.sessionCredits") == "Locked by managed policy “acme”")
        #expect(store.lock("permissions.mode") == nil)
        await store.set("budget.sessionCredits", to: .number(5))
        #expect(store.problems["budget.sessionCredits"] != nil)
        #expect(store.value("budget.sessionCredits")?.value == .number(100))
    }

    @Test func writesAndResetsTheUserLayer() async {
        let backend = FakeConfigBackend(defaults: ["permissions.mode": .string("ask")])
        let store = SettingsStore(backend: backend)
        await store.load()
        #expect(store.models.map(\.id) == ["model-a"])
        await store.set("permissions.mode", to: .string("auto"))
        #expect(store.value("permissions.mode")?.layer == .user)
        await store.reset("permissions.mode")
        #expect(store.value("permissions.mode") == ConfigValue(keyPath: "permissions.mode", value: .string("ask"), layer: .default, locked: false))
    }
}
