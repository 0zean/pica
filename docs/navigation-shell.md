# Navigation shell (A-04)

The main window (PLAN.md §7.1) is a `NavigationSplitView` with the sidebar and the session column, plus the
inspector as SwiftUI's trailing `.inspector`, which is how a third column is made toggleable. The code is in
`app/Packages/AppShell/Sources/AppShell/Navigation` (the store) and `Views` (the columns). The session column draws
a selected session with the `SessionContent` the app target passes to `RootView`: the timeline (A-05,
docs/session-timeline.md). The checks are
`NavigationShellUITests` and `SessionRenameDeleteUITests` in `app/PicaUITests`, `NavigationStoreTests` and
`SessionRenameDeleteTests` in AppShell's tests, and `engine/packages/server/tests/sessions/rename-delete.test.ts`.

## Data flow

`NavigationStore` is an `@Observable` store fed only by the `EngineClient` (EngineClient → store → view, §8):

- On every `connected` state, including after a reconnect, it loads `workspace.list`, `repo.list` for each
  workspace, and `session.list`. A reload replaces what the store holds, so a workspace deleted while the app was
  disconnected disappears.
- `workspace.changed` upserts the workspace and reloads its repos, since pinning, unpinning and syncing change them.
  `session.changed` upserts the session. `session.deleted` removes it (see
  [Renaming and deleting sessions](#renaming-and-deleting-sessions)).
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

## Renaming and deleting sessions

A session is renamed or deleted from four places, all of which ask `NavigationStore` (`beginRename`/`beginDelete`)
and are answered by one alert in `SessionActionDialogs`:

- the sidebar row's context menu (Rename…, Delete…);
- the timeline's title: double-click renames, and its context menu has both (`TimelineTitleActions`, which the app
  target fills, since Timeline does not depend on AppShell);
- File ▸ Rename Session… and Delete Session… (`renameSession`, `deleteSession` in A-14's registry), for the
  selected session; no default shortcut, since ⌘⌫ belongs to text fields;
- the ⌘K palette: “Rename <title>…” and “Delete <title>…” for every session, beside “Go to <title>”.

Rename shows the current title in a text field; Return saves. The engine trims it and keeps at most 200 characters;
an empty title clears it, and the session shows as “Untitled session” again (the engine has no automatic title yet;
when one comes, a cleared title falls back to it). Renaming does not change `updatedAt`, so the session keeps its
place in the sidebar.

Delete asks first, naming the session: “Delete “<title>”?”, saying that its timeline (messages, tool calls and
agents), pending approvals and attached MCP servers are deleted and that this cannot be undone, that the user's
repositories are not touched, and that its credits stay in the usage totals. For a session that is working
(starting, running or waiting for approval) it adds that deleting stops it first. Once the engine answers (or its
`session.deleted` arrives first), the row goes; when it was selected, the next session in the same workspace in
sidebar order is selected, else the previous one, else the workspace. ⌘1–9 and Select Next/Previous Session follow
the sidebar as it now is. A deleted id is remembered, so a `session.changed` that was in flight, or a reload that
started before the deletion, does not bring the row back. A refused rename or delete shows an alert with the error
code.

Engine side (protocol `session.rename {sessionId, title}` → `{session}`, `session.delete {sessionId}` → `{ok}`,
notification `session.deleted {sessionId}`; additions, so the protocol version is unchanged and an older engine
answers `method_not_found`):

- **Live sessions are ended, not refused.** Delete works in every state: a live session's runtime is closed first
  (a running turn stops, pending approvals are dropped), as `session.end` does, and the X-03 `sessionEnd` hook runs
  for a session that had not ended. There is no `invalid_state` for delete.
- **What goes:** the session's events (in the same transaction that marks it deleted), what the runtime keeps of it
  (Copilot's `deleteSession`: transcript and state, so it can never be resumed), its MCP attachments
  (`attachments.json`), and its engine-owned files under `<data dir>/sessions/<id>/` (C-06 artifacts). Sessions own
  no worktrees yet (R-10 has not filled `writeRoots`); write and reference roots are the user's repositories and
  are never touched.
- **What stays:** the `sessions` row, with `deleted_at` set and its title cleared (store migration 4), so its usage
  records keep their foreign key. Usage reports, the workspace daily cap and C-09 budgets therefore count what the
  session spent; `usage.rollup` grouped by session still lists its id. The H-02 audit log is append-only and keeps
  its entries. `session.get`, `session.list`, `events.subscribe` and every other `session.*` method answer
  `not_found` for a deleted session.

## Keyboard

- The sidebar has the focus when the window opens. Up and Down move the selection, and selecting a row opens it in
  the session column. Left and Right collapse and expand a workspace.
- ⌘1–⌘9 (Go menu) select the first nine sessions in sidebar order, expanding a collapsed workspace.
- ⌥⌘I shows and hides the inspector (View menu and toolbar). ⌃⌘S toggles the sidebar (`SidebarCommands`).
- ⌘K, ⌘P and ⌘N belong to A-14, A-09 and A-12 (New Session, [workspaces.md](workspaces.md#new-session)). Selecting
  a session that was just created goes through `NavigationStore.sessionCreated`, which holds it until its
  `session.changed` arrives.

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
sun_path's 104 bytes; `PicaUnderTest` asserts it). `make app-ui-test-pica` builds into
`~/Library/Caches/dev.pica.ui-tests/<checkout hash>/derived` and copies `engine/` next to it, passed as
`TEST_RUNNER_PICA_UI_TEST_ENGINE`: Node runs as Pica's child and the runner reads the Pica.app it launches, so either
under `~/Documents` would make macOS ask each rebuilt, ad-hoc-signed Pica or runner for the Documents folder.
The sidebar's width lives in the app's real defaults domain, so the
UI tests change it for the developer's own copy of Pica too, as the window frame already did. The test creates workspaces, repos and sessions through its own
`EngineClient`, from a synchronous test: an async XCTest whose XCUITest call fails can hang in its tear-down. It cannot
run git, so it writes the few files of an empty repository with an `origin` by hand.

`SessionRenameDeleteUITests` uses `fake-picad`'s `sessions` scenario: a session's first message ends idle and its
second runs until the session is stopped or deleted, so the test can delete a working session.

XCUITest moves a divider only with `click(forDuration:thenDragTo:)` on the splitter element; `press(...)` does
nothing. The first launch of a freshly built Pica can take several seconds longer, so `PicaUnderTest.launch()` allows
30 s for the engine to connect.
