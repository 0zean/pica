import DesignSystem
import Foundation
import PicaProtocol
import Testing
@testable import PicaSettings

@MainActor
@Suite struct AppearanceStoreTests {
    private static let defaults: [String: JSONValue] = [
        AppearanceStore.themeKey: .string("pica"), AppearanceStore.densityKey: .string("regular"), AppearanceStore.accentKey: .null,
    ]

    private func themes(_ files: [String: String]) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appending(path: "pica-themes-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for (name, text) in files {
            try Data(text.utf8).write(to: directory.appending(path: name))
        }
        return directory
    }

    @Test func listsValidThemesAndNamesTheUnknownTokenInABadOne() async throws {
        let directory = try themes([
            "harbor.jsonc": ##"{ "name": "Harbor", "colors": { "accent": "#2F6F8F" } }"##,
            "typo.jsonc": ##"{ "colors": { "accnet": "#2F6F8F" } }"##,
            "notes.txt": "not a theme",
        ])
        let store = AppearanceStore(backend: FakeConfigBackend(defaults: Self.defaults), themesDirectory: directory)
        await store.load()
        #expect(store.library.themes.map(\.id) == ["pica", "harbor"])
        #expect(store.library.problems.map(\.file) == ["typo.jsonc"])
        #expect(store.library.problems.first?.message.contains("“accnet”") == true)
    }

    @Test func choosingAThemeWritesItsNameAndDrawsIt() async throws {
        let directory = try themes(["harbor.jsonc": ##"{ "name": "Harbor", "colors": { "accent": "#2F6F8F" } }"##])
        let backend = FakeConfigBackend(defaults: Self.defaults)
        let store = AppearanceStore(backend: backend, themesDirectory: directory)
        await store.load()
        await store.setTheme("harbor")
        #expect(backend.userLayer[AppearanceStore.themeKey] == .string("harbor"))
        #expect(store.theme.id == "harbor")
        #expect(Palette.accent.rgb(for: .dark, in: store.theme) == RGB(0x2F6F8F))
        await store.setTheme("pica")
        #expect(backend.userLayer[AppearanceStore.themeKey] == nil)
    }

    @Test func aMissingThemeFallsBackToTheBuiltInOne() async throws {
        let backend = FakeConfigBackend(defaults: Self.defaults)
        try await backend.set(AppearanceStore.themeKey, to: .string("gone"))
        let store = AppearanceStore(backend: backend, themesDirectory: try themes([:]))
        await store.load()
        #expect(store.missingTheme == "gone")
        #expect(store.theme == .pica)
    }

    @Test func densityAndAccentAreWrittenAndApplied() async throws {
        let backend = FakeConfigBackend(defaults: Self.defaults)
        let store = AppearanceStore(backend: backend, themesDirectory: try themes([:]))
        await store.load()
        await store.setDensity(.compact)
        await store.setAccent(RGB(0xB4533A))
        #expect(backend.userLayer[AppearanceStore.densityKey] == .string("compact"))
        #expect(backend.userLayer[AppearanceStore.accentKey] == .string("#B4533A"))
        #expect(store.density == .compact)
        #expect(Palette.accent.rgb(for: .light, in: store.theme) == RGB(0xB4533A))
        #expect(store.layers[AppearanceStore.accentKey] == .user)
        await store.setAccent(nil)
        await store.setDensity(.regular)
        #expect(backend.userLayer.isEmpty)
        #expect(store.theme == .pica)
    }

    @Test func aLockedKeyNamesThePolicyAndRefusesWrites() async throws {
        let backend = FakeConfigBackend(
            defaults: Self.defaults, locked: [AppearanceStore.densityKey: .string("comfortable")], policy: "acme")
        let store = AppearanceStore(backend: backend, themesDirectory: try themes([:]))
        await store.load()
        #expect(store.density == .comfortable)
        #expect(store.locks[AppearanceStore.densityKey] == "Locked by managed policy “acme”")
        await store.setDensity(.compact)
        #expect(store.density == .comfortable)
        #expect(store.problems[AppearanceStore.densityKey] != nil)
    }

    @Test func themeIdsFollowConfigRules() {
        #expect(ThemeLibrary.isValidId("harbor-2.dark"))
        #expect(!ThemeLibrary.isValidId(".hidden"))
        #expect(!ThemeLibrary.isValidId("with space"))
        #expect(!ThemeLibrary.isValidId("é"))
    }
}
