import Testing
@testable import PicaSettings

@Suite struct ShortcutTests {
    @Test(arguments: [
        ("cmd+k", "cmd+k", "⌘K"),
        ("shift+cmd+k", "shift+cmd+k", "⇧⌘K"),
        ("cmd+ctrl+j", "ctrl+cmd+j", "⌃⌘J"),
        ("Option+Command+I", "alt+cmd+i", "⌥⌘I"),
        ("cmd+alt+down", "alt+cmd+down", "⌥⌘↓"),
        ("cmd+,", "cmd+,", "⌘,"),
    ])
    func readsAndWrites(text: String, written: String, shown: String) throws {
        let shortcut = try #require(Shortcut(text))
        #expect(shortcut.description == written)
        #expect(shortcut.displayString == shown)
        #expect(Shortcut(shortcut.description) == shortcut)
    }

    @Test(arguments: ["", "cmd+", "cmd+cmd+k", "hyper+k", "cmd+pageup", "cmd++"])
    func refuses(text: String) {
        #expect(Shortcut(text) == nil)
    }

    @Test func plainKeysAreNotUsable() {
        #expect(Shortcut("k")?.isUsable == false)
        #expect(Shortcut("shift+k")?.isUsable == false)
        #expect(Shortcut("escape")?.isUsable == true)
        #expect(Shortcut("ctrl+k")?.isUsable == true)
    }
}
