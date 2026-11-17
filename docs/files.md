# Files and quick open (A-09)

The Files pane of the inspector, ⌘P quick open across the workspace's repos, a read-only viewer, and opening a file in
the user's editor. Code: `engine/packages/core/src/files/` (ranking, index, service),
`engine/packages/server/src/files-handlers.ts` and `composition-files.ts`, and the feature package `app/Packages/Files`.

## What a repo's files are

Git decides: a repo's files are what `git ls-files --cached --others --exclude-standard` lists in its checkout (R-08's
`RepoFiles`), so ignored files and `.git` never appear, and untracked files that are not ignored do. Directories are the
prefixes of those paths; an empty directory does not exist. Repos that are not cloned are left out of quick open and
answer `files.list` with `invalid_state` (`files.not_cloned`). Files are read from the repo's checkout, not a session's
worktree.

Each repo root's listing is kept in memory with the time it was listed:

- `files.list` lists again first when the listing is more than 10 s old.
- `files.quickOpen` answers from whatever listing it has and lists again in the background when it is old, so a
  keystroke never waits for git. The first search of a repo waits for its listing; opening ⌘P sends an empty query,
  which matches nothing but lists the repos, so that wait happens before the first keystroke.

## Methods

No protocol change: A-09 serves what the protocol already declared.

| Method | Answer | Errors (`data.details.reason`) |
|---|---|---|
| `files.list {repoId, directory}` | Immediate children of `directory` ("" is the root): directories first, then files, each in code-point order. A symlink is `symlink`; a directory's `sizeBytes` is null. | `not_found` (`files.not_found`) for a directory with nothing listed under it; `invalid_params` (`files.outside_repo`) for a path that is absolute, climbs out, or resolves outside the repo |
| `files.read {repoId, path}` | The first 1 MB as text, `truncated` when there is more, and the size | `invalid_state` (`files.binary`) when the first 8,000 bytes hold a NUL; `not_found`; `invalid_params` (`files.outside_repo`), which includes a symlink that leads out of the repo |
| `files.quickOpen {workspaceId, query, limit}` | The best `limit` (at most 200) paths across the workspace's cloned repos, best first | `not_found` (`files.workspace_not_found`) |

Containment is the same as R-08's: the path is normalized lexically, then the real path of the target must be inside
the real path of the repo root.

## Ranking

`core/src/files/fuzzy.ts`, table-tested in `core/tests/files/ranking.test.ts`. A path matches when the query's
characters, lower-cased and without spaces, appear in it in order. Of all the ways to place them, the best total is
kept:

| Part | Score |
|---|---|
| Each matched character | 16 |
| Matched at the start of the path or after `/` | +10 |
| Matched after `-`, `_`, `.` or a space, or an upper-case letter after a lower-case one | +8 |
| Matched in the file name (the last segment) | +4 |
| Right after the previous match | the run's first bonus, at least +4 |
| A gap before a match | −3, and −1 for each further skipped character |
| The query is the whole file name / the start of it | +40 / +20 |

Ties go to the shorter path, then code-point order; across repos, then the repo id. So `main.ts` puts `src/main.ts`
before `src/main.tsx`, `button` puts `src/ui/button.swift` before `b/u/t/t/o/n.ts`, and `sc` puts
`src/SessionColumn.swift` before `lib/misc.ts`.

The table is computed only over the positions each query character can take (between its greedy match from the
start and its greedy match from the end), as lists of the positions it matches at; the best gap is a running maximum.
Paths are prepared once per listing into flat arrays of lower-cased code units and per-character bonuses. A ranker
remembers which paths the last query matched, and a query that extends it (the next keystroke) scores only those.

## Budget

PLAN.md §9: quick open over 100,000 files answers in under 50 ms per keystroke. Two tests type five queries (94
keystrokes) over a synthetic 100,000-path monorepo listing (`core/tests/files/large-index.ts`):

- `core/tests/files/benchmark.test.ts` times the ranker, each keystroke the median of three typings.
- `server/tests/files/quick-open-benchmark.test.ts` times `files.quickOpen` over the socket, request to reply, with
  the files split across two repos.

Measured on 2026-11-17 (Apple silicon, Node 22): slowest keystroke 20–22 ms (two- and three-letter prefixes, which
match most paths), median 0.5 ms over the socket.

## App

`app/Packages/Files` is a feature package (lint-arch rule in `engine/tools/lint-arch/app-graph.ts`); the app target
wires it in `PicaApp.swift`.

- **Inspector.** AppShell's inspector shows `InspectorPane`s the app target supplies, as tabs when there are more than
  one; the chosen tab is remembered. Each pane gets an `InspectorContext`: the workspace of the sidebar's selection,
  the selected session, and the client. Files is the first pane.
- **Tree (`FileTreeView`, `FileTreeStore`).** The workspace's repos by name; a directory lists its children from the
  engine when first expanded, and keeps them until the pane is drawn for another workspace. A workspace with one repo
  opens it at once. A file opens in the viewer on click; its menu also has Open in External Editor.
- **Quick open (`QuickOpenPanel`, `QuickOpenStore`).** File ▸ Quick Open… (⌘P, taken from Print) searches the selected
  item's workspace, or the only workspace there is. Each keystroke asks the engine at once, with no delay; while a
  search is out, later keystrokes wait and only the newest query is sent next, so replies never arrive out of order.
  The selection stays on the same file when the results change. ↑/↓ move, Return opens the viewer, ⌘Return the
  external editor, Escape or a click outside closes.
- **Viewer (`FileViewerScreen`).** A window per file (`WindowGroup(id: "file-viewer", for: FileReference.self)`):
  the path, repo and size, and the text in a non-editable `NSTextView` (monospaced, no wrapping, find bar). Binary
  files and files the engine refuses show why instead. ⇧⌘O or the button opens the file in the external editor.
- **External editor (`ExternalEditor`).** `NSWorkspace.open` on the file in the repo's checkout: the app macOS opens
  that kind of file with. `PICA_EXTERNAL_EDITOR_LOG` makes it append the path to a file instead, for UI tests.

## Tests

- Engine: `core/tests/files/` (ranking table, service, benchmark), `server/tests/files/` (the methods over a real git
  checkout, and the socket benchmark).
- App: `swift test --package-path app/Packages/Files` (quick-open ordering and selection, tree expansion, viewer).
- UI: `FilesUITests` (tree → viewer → external editor; ⌘P across two repos, Return, ⌘Return, Escape) and
  `ComposerUITests.testFilesAndSkillsComplete`. They run against `fake-picad`'s `empty` scenario: files need no
  runtime, only repos on disk, which `PicaUnderTest.makeRepository(_:files:)` writes.

## Not done

- Files are read from the repo's checkout; a session's worktree (its uncommitted changes) is not shown separately.
- The listing does not watch the filesystem; a new file appears within 10 s (tree) or on the keystroke after (quick
  open).
- No syntax highlighting in the viewer, and no match highlighting in quick open's rows (the hit has no positions).
- Skills come from a `files.list` of two folders per repo; there is no `skills.*` method.
