import Foundation
import Testing
@testable import DesignSystem

@Suite struct ThemeFileTests {
    private func parse(_ text: String) throws(ThemeFileError) -> Theme {
        try ThemeFile.parse(Data(text.utf8), id: "test")
    }

    @Test func anUnknownTokenFailsValidationNamingTheToken() {
        let text = ##"{ "name": "Typo", "colors": { "accent": "#2F6F8F", "accnet": "#112233" } }"##
        #expect(throws: ThemeFileError.unknownToken("accnet")) { try parse(text) }
        do {
            _ = try parse(text)
        } catch {
            #expect(error.description.contains("“accnet”"))
        }
    }

    @Test func otherMistakesNameWhereTheyAre() {
        #expect(throws: ThemeFileError.unknownKey("colours")) { try parse(##"{ "colours": {} }"##) }
        #expect(throws: ThemeFileError.unknownAppearance(token: "border", key: "night")) {
            try parse(##"{ "colors": { "border": { "night": "#000000" } } }"##)
        }
        #expect(throws: ThemeFileError.invalidColor("accent.dark", "blue")) {
            try parse(##"{ "colors": { "accent": { "dark": "blue" } } }"##)
        }
        #expect(throws: ThemeFileError.invalidColor("danger", "#ABC")) { try parse(##"{ "colors": { "danger": "#ABC" } }"##) }
        #expect(throws: ThemeFileError.invalidName) { try parse(##"{ "name": "  " }"##) }
        #expect(throws: ThemeFileError.notAnObject) { try parse("[]") }
    }

    @Test func aStringSetsEveryAppearanceAndAnObjectSomeOfThem() throws {
        let theme = try parse("""
            {
              // Comments and trailing commas are JSONC.
              "name": "Harbor",
              "colors": {
                "accent": "#2F6F8F",
                "background": { "light": "#FFFFFF", "dark": "#101318", },
              },
            }
            """)
        #expect(theme.id == "test")
        #expect(theme.name == "Harbor")
        for appearance in Appearance.allCases {
            #expect(Palette.accent.rgb(for: appearance, in: theme) == RGB(0x2F6F8F))
            #expect(Palette.surface.rgb(for: appearance, in: theme) == Palette.surface.rgb(for: appearance))
        }
        #expect(Palette.background.rgb(for: .light, in: theme) == RGB(0xFFFFFF))
        #expect(Palette.background.rgb(for: .darkIncreasedContrast, in: theme) == RGB(0x101318))
    }

    @Test func aMissingAppearanceKeepsTheBuiltInValue() throws {
        let theme = try parse(##"{ "colors": { "border": { "light": "#C0C0C0" } } }"##)
        #expect(theme.name == "test")
        #expect(Palette.border.rgb(for: .light, in: theme) == RGB(0xC0C0C0))
        #expect(Palette.border.rgb(for: .dark, in: theme) == Palette.border.dark)
    }

    @Test func aCustomAccentGetsAReadableOnAccent() {
        for accent in [RGB(0xB4533A), RGB(0xF2D16B), RGB(0x1D3557)] {
            let theme = Theme.pica.withAccent(accent)
            for appearance in Appearance.allCases {
                #expect(Palette.accent.rgb(for: appearance, in: theme) == accent)
                let ratio = Palette.onAccent.rgb(for: appearance, in: theme).contrast(with: accent)
                #expect(ratio >= 4.5, "onAccent on \(accent) in \(appearance): \(ratio)")
            }
        }
    }

    @Test func theExampleThemeInTheDocsIsValid() throws {
        let example = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "docs/themes/harbor.jsonc")
        let theme = try ThemeFile.parse(Data(contentsOf: example), id: "harbor")
        #expect(theme.name == "Harbor")
        #expect(!theme.colors.isEmpty)
    }

    @Test func hexStringsRoundTrip() {
        #expect(RGB(hexString: "#3E4251") == BrandColor.ink)
        #expect(RGB(hexString: "#3e4251")?.description == "#3E4251")
        #expect(RGB(hexString: "3E4251") == nil)
        #expect(RGB(hexString: "#3E425G") == nil)
        #expect(RGB(red: 0.2431, green: 0.2588, blue: 0.3176) == BrandColor.ink)
    }
}
