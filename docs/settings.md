# Settings and command palette (A-14)

Three pieces, all in `app/Packages/PicaSettings` (a feature package with the same layering rule as the others, §4.3:
it depends on `EngineClient`, `PicaProtocol` and `DesignSystem`, and on no other feature):

- the **action registry**: every command a user can run from a menu, the ⌘K palette or a shortcut;
- the **⌘K palette** over the registry;
- the **Settings scene**: a General pane that edits keys of the user's `config.jsonc`, and a Keyboard pane, the
  keybinding editor.

The app target (`app/Pica/AppActions.swift`) builds the stores, runs the actions and shows the palette, because each
action belongs to another feature (AppShell's navigation, AppKit's split view). The checks are `ActionRegistryTests`,
`ShortcutTests`, `KeybindingStoreTests` and `SettingsStoreTests` in the package, `config.test.ts` and
`config-value-writer.test.ts` in the engine, and `SettingsUITests` in `app/PicaUITests`.

## Action registry

`ActionID` is a `CaseIterable` enum; `ActionCatalog.definition(_:)` gives each its title, menu, default shortcut and
palette keywords. `ActionRegistry` runs an action through one closure the app target passes, which `switch`es over
`ActionID`: an action cannot be added without the compiler asking how to run it.

| Action | Default | Menu |
|---|---|---|
| Show Command Palette | ⌘K | View |
| Settings… | ⌘, | Pica |
| Keyboard Shortcuts… | — | Pica |
| Toggle Sidebar | ⌃⌘S | View |
| Toggle Inspector | ⌥⌘I | View |
| Select Next Session | ⌥⌘↓ | Window |
| Select Previous Session | ⌥⌘↑ | Window |

`ActionCommands` puts every action in its menu with its current shortcut. It replaces the system's Settings item and
SwiftUI's sidebar group, so those shortcuts can be rebound too. Not in the registry: ⌘1–9 (one per sidebar session,
AppShell's Go menu) and the composer's keys (⌘↩, ⇧⌘↩, ⌘., which are keys of the input, [composer.md](composer.md)).

## Palette

⌘K shows `CommandPaletteView` as a sheet over the main window. It lists every registry action, then one "Go to
<session>" row per sidebar session (`PaletteItem.other`, added by the app target). Typing filters: a title that starts
with the query ranks first, then a word that does, then a title that contains it, then a keyword match, then a title
with the query's letters in order. ↑ ↓ move, ↩ runs the selected row, ⎋ closes. A row shows its action's current
shortcut. The palette closes before the action runs, so an action that presents something presents it over the window.

## Keybindings

A shortcut is written `ctrl+alt+shift+cmd+key` (that order is written; any order is read, and `option`/`command` are
accepted). The key is one character or a name: return, escape, tab, space, delete, up, down, left, right. Shortcuts
live in config.jsonc under `keybindings`, a record by action id:

```jsonc
"keybindings": {
  "toggleInspector": "ctrl+cmd+j", // rebound
  "showCommandPalette": ""          // no shortcut
}
```

An action not listed keeps its default. The engine's schema checks only that ids look like ids and values are
strings; `KeybindingStore` reads the record, and lists entries for unknown actions or unreadable shortcuts as ignored
(kept in the file, shown under the editor). It loads on each connection to the engine.

In the editor (Settings ▸ Keyboard) a click on a shortcut records the next key press (an `NSEvent` local monitor, so a
menu shortcut is recorded rather than run). ⎋ cancels, ⌫ leaves the action without a shortcut. A shortcut is refused,
with the reason under the list, when it has none of ⌘ ⌃ ⌥ (typing could set it off) or another action already has it.
Choosing the default removes the entry; Reset does the same. Each change is written with `config.set` before it is shown.
If a managed policy locks `keybindings`, the editor is read-only and names the policy.

## Settings

The General pane edits the keys worth a control: `routing.profile`, `routing.tiers.reasoning` and `.worker` (Auto or a
model the policy allows, from `models.list`), `budget.sessionCredits`, `budget.workspaceDailyCredits` and
`permissions.mode`. Each row reads its key with `config.get` when the pane appears and writes with `config.set`; "Use
Default" (shown when the user's file sets the key) writes `null`, which removes it. Every other key is edited in the
file; the pane says where it is.

A key a managed policy locks (H-01, [managed-policy.md](managed-policy.md)) comes back from `config.get` with
`locked: true` and `lockedBy: "<policy id>"`. Its control is disabled and a line under it says "Locked by managed
policy “acme”". A write to it is refused by the engine anyway.

## Engine: `config.get` and `config.set`

Served by the production composition since A-14 (`engine/packages/server/src/config-handlers.ts`). Only the user layer
and the managed policy are composed (workspace and repo layers apply per session, a follow-up), so both ignore
`workspaceId` and `repoId`.

- `config.get { keyPath }` returns `{ keyPath, value, layer, locked, lockedBy? }` from the config as last loaded.
  A key holding an object (`routing.tiers`, `keybindings`) is reported from its leaves: the highest layer among them,
  locked if any is. An unknown key answers `not_found`.
- `config.set { keyPath, value, layer: "user" }` edits the user's `config.jsonc` in place with `jsonc-parser`, keeping
  comments and formatting, as A-07's `appendPermissionRule` does (both use `config-file-edit.ts`). `null` removes the
  key. The file is replaced atomically and only when the result validates; otherwise `config_invalid` with the reason.
  A key the policy locks, or a key above or below one, answers `policy_denied` naming the policy. Another layer
  answers `invalid_params`.

The config is re-read on each use, so a written value applies to the next session and the next `config.get`.
Protocol change: `ConfigValue` gains the optional `lockedBy`; config gains `keybindings`.

## Testing

`fake-picad` loads `PICA_TEST_MANAGED_POLICY` (a JSONC policy file) as if root owned it, so a UI test can lock keys.
`PicaUnderTest(managedPolicy:)` writes the file into the test's home. `SettingsUITests`:

- opens the palette with ⌘K and finds a row for every `ActionCatalog.all` entry (the UI test target links
  `PicaSettings` to enumerate it), then runs Toggle Inspector from it;
- rebinds Toggle Inspector to ⌃⌘J in Settings ▸ Keyboard, checks `config.jsonc`, relaunches, and checks that ⌥⌘I no
  longer opens the inspector and ⌃⌘J opens and closes it;
- locks `budget.sessionCredits` with a policy `acme` and checks the field is disabled, shows 100, and the lock line
  names `acme`, while an unlocked field stays enabled.
