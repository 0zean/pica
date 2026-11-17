# Navigation shell (A-04)

The main window (PLAN.md §7.1) is a `NavigationSplitView` with the sidebar and the session column, plus the
inspector as SwiftUI's trailing `.inspector`, which is how a third column is made toggleable. The code is in
`app/Packages/AppShell/Sources/AppShell/Navigation` (the store) and `Views` (the columns). The checks are
`NavigationShellUITests` in `app/PicaUITests` and `NavigationStoreTests` in AppShell's tests.

## Data flow

`NavigationStore` is an `@Observable` store fed only by the `EngineClient` (EngineClient → store → view, §8):

- On every `connected` state, including after a reconnect, it loads `workspace.list`, `repo.list` for each
  workspace, and `session.list`. A reload replaces what the store holds, so a workspace deleted while the app was
  disconnected disappears.
- `workspace.changed` upserts the workspace and reloads its repos, since pinning, unpinning and syncing change them.
  `session.changed` upserts the session.
- It listens for both notifications before the first load. A notification that arrives while a reload is waiting
  for the engine wins over the reload's older answer.
- A failed request is shown under the sidebar with its error code.

The engine does not announce `workspace.delete` or `repo.addPath`/`repo.remove`; those show up on the next
`workspace.changed` for the workspace or the next reconnect.

## Sidebar

Each workspace is a disclosure row. Under it are its repos, in the engine's order (pinned first), and then its
sessions. Sessions that need the user (`awaiting_approval`, `failed`) come first, then the rest, most recently
updated first. A session row shows the activity mark (animated while starting or running) and a chip for running,
waiting and failed sessions. A repo appears under every workspace that includes it, so its row is identified by both.

## Keyboard

- The sidebar has the focus when the window opens. Up and Down move the selection, and selecting a row opens it in
  the session column. Left and Right collapse and expand a workspace.
- ⌘1–⌘9 (Go menu) select the first nine sessions in sidebar order, expanding a collapsed workspace.
- ⌥⌘I shows and hides the inspector (View menu and toolbar). ⌃⌘S toggles the sidebar (`SidebarCommands`).
- ⌘K, ⌘P and ⌘N belong to A-14, A-09 and A-06.

## Window restoration

- AppKit keeps the window frame and the sidebar's width in the app's defaults (`NSWindow Frame main` and
  `NSSplitView Subview Frames main, SidebarNavigationSplitView`). It wins over the sidebar's `ideal` width, which
  therefore only sets the first launch, so Pica does not store the sidebar's width a second time.
- Pica writes the rest to `window-state.json` next to the socket (like `app.lock`, docs/app-shell.md): the
  selection, whether the inspector is shown and its width, and which workspaces are collapsed. The inspector's split
  view has no autosave. The view measures its width; a write happens 250 ms after the last change, and again on quit.
- At launch the inspector opens at the saved width, clamped to its limits, and is the user's to drag from there.
- A saved selection whose item no longer exists after the first load is cleared. A file that is missing or cannot be
  read gives the defaults.

## Tests

The UI tests launch Pica against `fake-picad.ts` with a data directory per test. The runner is sandboxed and may only
connect to sockets in its own container, so the socket is in the runner's temporary directory (it must stay under
sun_path's 104 bytes; `PicaUnderTest` asserts it). The sidebar's width lives in the app's real defaults domain, so the
UI tests change it for the developer's own copy of Pica too, as the window frame already did. The test creates workspaces, repos and sessions through its own
`EngineClient`, from a synchronous test: an async XCTest whose XCUITest call fails can hang in its tear-down. It cannot
run git, so it writes the few files of an empty repository with an `origin` by hand.

XCUITest moves a divider only with `click(forDuration:thenDragTo:)` on the splitter element; `press(...)` does
nothing. The first launch of a freshly built Pica can take several seconds longer, so `PicaUnderTest.launch()` allows
30 s for the engine to connect.
