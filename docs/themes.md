# Themes and density (X-01)

PLAN.md §7.4 asks for a theme (accent, density, code font and size) kept in plain files with a Settings UI that
edits the same files. X-01 covers the theme, the density and the accent; the code font and size are not done.

Three config.jsonc keys, edited in Settings ▸ Appearance or in the file:

```jsonc
"appearance": {
  "theme": "harbor",     // "pica" (the built-in theme) or a theme file's name, without .jsonc
  "density": "compact",  // "compact", "regular" or "comfortable"
  "accent": "#B4533A"    // #RRGGBB over the theme's accent; null keeps the theme's
}
```

The defaults are `"pica"`, `"regular"` and `null`. A managed policy can lock each of them (H-01); the pane then shows
the control disabled with the policy named, like the General pane ([settings.md](settings.md)).

## Where it lives

- `DesignSystem` (A-03) owns the model: `ThemeToken`, `Theme`, `ThemeFile` (parsing and validation), `Density`, and
  `View.picaAppearance(theme:density:)`.
- `PicaSettings` (A-14) owns `ThemeLibrary` (reads the themes folder), `AppearanceStore` (the three keys through
  `config.get`/`config.set`) and the Appearance pane.
- The app target makes the store in `AppActions` and applies `AppearanceHost` to every window: the main window,
  Settings, file viewers, MCP Servers and Usage.
- Engine: config gains `appearance` (`engine/packages/protocol/src/config-file.ts`). The engine does not read theme
  files; the app does, since a theme only changes how the app draws.

## How a theme applies

Every `Palette` role is a `PicaColor` carrying its `ThemeToken`. When SwiftUI resolves a `PicaColor`, it looks up the
token in the environment's `picaTheme` and draws the theme's value if there is one, otherwise the built-in value. So
every view that draws with `Palette` follows the theme, with no change to the view. `picaAppearance` also sets the
controls' `tint` to the accent, so system controls (pickers, toggles, selection) follow it too.

`PicaColor.rgb(for:)` is still the built-in value, which `ContrastTests` checks. Code that turns a token into an
AppKit color by hand (the composer's text view, `NSColor(_ token:)`) does not follow the theme yet.

A custom accent replaces `accent` in every appearance. `onAccent`, the text on filled buttons, becomes white or the
dark background color, whichever contrasts more with the accent (black under increased contrast). When the accent has
less than 3:1 against the theme's background in light or dark, the pane warns under the color well; it is still
saved.

## Theme files

A theme is a JSONC file in `~/Library/Application Support/Pica/themes/`; its file name without `.jsonc` is its id.
[themes/harbor.jsonc](themes/harbor.jsonc) is an example, checked by `ThemeFileTests`.

```jsonc
{
  "name": "Harbor",                // shown in the picker; defaults to the id
  "colors": {
    "accent": "#2F6F8F",           // one value for every appearance
    "background": { "light": "#F6F8FA", "dark": "#14181D" }  // or some appearances
  }
}
```

- The tokens are the `Palette` roles: `background`, `surface`, `textPrimary`, `textSecondary`, `border`, `accent`,
  `onAccent`, `ring`, `spark`, `success`, `warning`, `danger`, `gradientStart`, `gradientEnd`.
- An appearance is `light`, `dark`, `lightIncreasedContrast` or `darkIncreasedContrast`. One left out keeps the role's
  built-in value, except that an increased-contrast value left out takes the file's own light or dark value when the
  file gives one.
- Every key is checked. An unknown top-level key, an unknown token, an unknown appearance, or a color not written
  `#RRGGBB` makes the file invalid, with a message naming it, e.g. `Unknown token “accnet”. Known tokens: …`.
- A file name may use letters, digits, `.`, `_` and `-`, starting with a letter or digit (the rule config.jsonc's
  `appearance.theme` has). `pica.jsonc` is refused: that is the built-in theme.
- Themes are not checked for contrast. Pica's own palette is (`ContrastTests`); a theme's author is responsible for
  theirs.

The pane lists each invalid file under the picker with its message. When config.jsonc names a theme with no valid
file, the built-in theme is drawn and the pane says so. The folder is read when Pica connects to its engine, when the
pane opens, and on Reload Themes; it is not watched. Show Themes Folder creates it and reveals it in the Finder.

## Density

`Density` scales component padding and gaps (`density.spacing(_:)`: ×0.75, ×1, ×1.25, on whole points), and sets the
system's control size (small, regular, large) and the minimum list row height (22, 28, 34 points) for the whole
window, which the sidebar's list follows. The DesignSystem components (`Card`, `Chip`,
`PicaButtonStyle`, `EmptyState`) and the gallery read it. Feature views that use `Spacing` constants directly keep
their spacing; they can adopt density by reading `\.picaDensity` as the components do. Regular is exactly A-03's
layout, so its gallery references did not change.

## Testing

- `ThemeSnapshotTests` (DesignSystem): the gallery at each density, and with a custom accent (`#B4533A`) in light
  and dark. Compact is shorter than regular, which is shorter than comfortable, and the accent changes only accented
  pixels. References are per macOS major, as A-03's are.
- `ThemeFileTests` (DesignSystem): an unknown token fails with the token named; other mistakes name their key; the
  string and object forms; the fallbacks; a custom accent's `onAccent` reads at 4.5:1; the docs' example is valid.
- `AppearanceStoreTests` (PicaSettings): the library lists valid themes and names the bad token, choices are written,
  a missing theme falls back, and a locked key names its policy.
- `SettingsUITests.testTheAppearancePaneChoosesAThemeAndDensityAndNamesABadToken`: with two theme files, the pane
  names the unknown token, and choosing Harbor and Compact writes both to config.jsonc.
- Engine: `config.test.ts` reads, writes and refuses a malformed accent; `lockable-keys.test.ts` locks all three keys.
