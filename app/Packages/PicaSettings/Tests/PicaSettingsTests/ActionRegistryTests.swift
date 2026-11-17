import Testing
@testable import PicaSettings

@MainActor
@Suite struct ActionRegistryTests {
    let registry = ActionRegistry { _ in }

    /// A-14 verify: every action in the registry is in the palette, and a search for its title finds it first.
    @Test func everyActionIsInThePalette() {
        let palette = CommandPaletteModel(registry: registry)
        let listed = Set(palette.results.compactMap { item -> ActionID? in
            if case .action(let id) = item.target { return id }
            return nil
        })
        #expect(listed == Set(ActionID.allCases))
        for definition in registry.definitions {
            palette.query = definition.title
            #expect(palette.selected?.target == .action(definition.id), "searching \(definition.title)")
        }
    }

    @Test func registryHasEveryActionOnceWithDistinctDefaults() {
        #expect(registry.definitions.map(\.id) == ActionID.allCases)
        let shortcuts = registry.definitions.compactMap(\.defaultShortcut)
        #expect(Set(shortcuts).count == shortcuts.count)
        #expect(shortcuts.filter { !$0.isUsable }.isEmpty)
    }

    @Test func performingRunsTheHandler() {
        var ran: [ActionID] = []
        let registry = ActionRegistry { ran.append($0) }
        let palette = CommandPaletteModel(registry: registry)
        palette.query = "inspector"
        if case .action(let id) = palette.selected?.target { registry.perform(id) }
        #expect(ran == [.toggleInspector])
    }

    @Test func paletteMatchesKeywordsAndLettersInOrderAndAddsExtraItems() {
        let palette = CommandPaletteModel(registry: registry) {
            [PaletteItem(target: .other("session.s1"), title: "Go to Fix the build", subtitle: "Atlas")]
        }
        palette.query = "preferences"
        #expect(palette.selected?.target == .action(.openSettings))
        palette.query = "tgsdb"
        #expect(palette.results.map(\.target) == [.action(.toggleSidebar)])
        palette.query = "fix"
        #expect(palette.selected?.target == .other("session.s1"))
        palette.query = ""
        palette.moveSelection(by: -1)
        #expect(palette.selected?.target == .other("session.s1"))
    }
}
