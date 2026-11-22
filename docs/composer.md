# Composer (A-06)

The composer sits under the selected session's timeline (PLAN.md §7.1): a multiline input, completions for `@`
mentions and `/` skills, the routing profile and tier pickers, and the controls that send, queue, steer and stop. The
code is in `app/Packages/Composer`, a feature package with the same layering rule as the others (§4.3: it depends on
`EngineClient`, `PicaProtocol` and `DesignSystem`, and not on Timeline). The app target puts it under the timeline in
the `SessionContent` closure it hands AppShell, so neither AppShell nor Timeline knows about it. The checks are
`MentionTokenizerTests`, `MentionResolverTests` and `ComposerStoreTests` in the package, and `ComposerUITests` and
`ComposerLatencyUITests` in `app/PicaUITests`.

## Data flow

`SessionComposer` owns one `ComposerStore` per session (the column gives the session's content `.id(sessionId)`).
The app target passes the session again whenever the engine reports a change (`session.changed` through
`NavigationStore`), so the store always knows the session's state. Engine calls go through `ComposerBackend`, which
`EngineComposerBackend` implements over `EngineClient`; the store's tests use a fake.

The text lives in the input, an `NSTextView`. The store hears of each change and of each caret move, and edits the text
only through the input (inserting a completion, clearing it after a send), so every edit can be undone. Nothing on screen
reads the text itself: views observe only whether it is blank, the completion list and the status line, so a keystroke
redraws the input and nothing else. The timeline is a separate observable and is not touched by typing.

Unsent text is kept per session in `ComposerDrafts`, which the app target owns for the window, so switching sessions
keeps a half-written message. Drafts are not saved across launches.

## Input and keys

`NSTextView` (TextKit 1) rather than SwiftUI's `TextEditor`, for the key handling completions need, temporary attributes
to color mentions without touching the text, and a measured height. The input grows from one line to eight, then
scrolls. Smart quotes and dashes are off, since `@"…"` and `--flags` must stay as typed.

| Key | While the completion list shows | Otherwise |
|---|---|---|
| ⌘↩ | Sends | Sends when idle; queues while a turn runs |
| ⇧⌘↩ | Steers | Steers while a turn runs; sends when idle |
| ⌘. | Stops the turn | Stops the turn |
| Return | Inserts the selected item | New line |
| Tab | Inserts the selected item | Tab |
| ↑ ↓ | Move the selection (wrapping) | Move the caret |
| Escape | Hides the list until the caret leaves the mention | — |

A click on a row inserts it too. An inserted item replaces the whole mention under the caret, not just the part before
it, and is followed by a space unless one is already there.

The list opens upward from the composer's box, over the timeline (the composer has the higher `zIndex` in the session
column). It is as tall as its rows, at most up to `Spacing.small` below the top of `ComposerView.completionBounds`, a
coordinate space the app target declares on the session column; past that it scrolls, and ↑ ↓ scroll it just enough
to keep the selected row in view. So it stays inside the column at any window height, and moves up as the input grows.
Without the coordinate space, the window's top is the limit. `CompletionListLayoutTests` (in the package) checks this
in a real window at several heights, and `ComposerUITests` checks every row is inside the window and above the input.

## Mentions and skills

`MentionTokenizer` finds tokens in the text, with ranges in UTF-16 units as `NSTextView` counts them, and finds the
token the caret is typing for completions. The rules:

- `@` starts a mention at the start of the text, after whitespace, or after one of `( [ { < " '`. So an address
  (`me@example.com`) and a code span (`` `@x` ``) are text.
- An unquoted name runs to whitespace or one of `, ; ! ? ( ) [ ] { } < > " ' ` @`. A trailing `.` or `:` is
  punctuation, so `see @atlas.` mentions `atlas`. `@"…"` quotes a name with spaces and ends at the closing quote on
  the same line. An empty name is text.
- `/` starts a skill at the start of a line, after spaces or tabs at most. The name is letters, digits, `-`, `_` and
  `.`, and must be followed by whitespace or the end, so `/usr/bin` is text.

`MentionResolver` says what a name is: an agent's name (`@bulk-reader`), a repo's (`@atlas`), or `repo:path` for a file
(`@atlas:src/main.swift`). An agent wins over a repo of the same name. Repos go by the last part of their remote URL or
path without `.git`, as in the sidebar. Mentions that resolve, and skills that exist, are drawn in the accent color.

Completions come from:

| Trigger | Items | Source |
|---|---|---|
| `@` | Repos of the session's workspace | `repo.list {workspaceId}` |
| `@` | Agents | `agents.list {workspaceId}` |
| `@` | Files, once something is typed | `files.quickOpen {workspaceId, query}`, 60 ms after typing pauses |
| `/` | Skills | `files.list` of `.github/skills` and `.claude/skills` in each workspace repo: one skill per directory |

Repos, agents and skills load once when the composer appears; files are searched as the query changes, and a search
whose query is no longer the one being typed is dropped.

The engine did not serve `agents.list`, `models.*`, `files.*` or `config.*` before A-06, though the protocol declares
them (`config.*` is served since A-14). A-06 adds `agents.list`, `models.list` and `models.tiers` to the production composition
(`engine/packages/server/src/catalog-handlers.ts`), from the agent loader and model catalog sessions already use.
`agents.list` returns the built-in and user agents; workspace and repo agent layers are not composed yet, so it ignores
`workspaceId` and `repoId`. A-09 serves `files.quickOpen` and `files.list` ([files.md](files.md)), so files and
skills complete: file hits use quick open's ranking, and a skill is a directory of a skill folder that git lists a file
in. If a file search fails, searching stays off for that composer, and a failed skill listing leaves the list empty.
No method or type was added to the protocol. Items are ranked by prefix match, then a match at a word
start, then a substring, then the letters in order, ignoring case; eight at most.

### What is sent

The engine has no notion of mentions, so the message is the text as written. When it mentions repos or files whose
location is known, a closing block lists where they are, so the agent need not guess which checkout `atlas` is:

```
compare @atlas:src/a.ts with the docs

---
@atlas:src/a.ts: /…/worktrees/atlas/src/a.ts
```

A write repo's location is the session's worktree for it; another repo's is its local checkout. Agents and skills are
sent as written: Copilot's agent reads `@bulk-reader` and `/review` in the prompt.

## Sending, queueing and steering

All three are `session.send {sessionId, text, mode}`; stopping is `session.abort`. No protocol change was needed.

| Session state | ⌘↩ (primary button) | ⇧⌘↩ (Steer button) | Stop |
|---|---|---|---|
| `idle` | `send` ("Send") | `send` | — |
| `running`, `awaiting_approval` | `queue` ("Queue") | `steer` | shown |
| `starting`, `ended`, `failed`, `resumable` | disabled | disabled | — |

The input is cleared at once, and given back if the engine refuses the message or the call fails, with the reason in
the status line. A `send` the engine does not accept because a turn started meanwhile (`accepted: false`) is sent
again as `queue`. After a queue or steer the status line says what happens next ("Queued. It runs after the current
turn."). The timeline already shows each `user.message` with its mode, so the composer keeps no list of its own.

## Profile and tier pickers

The engine fixes a session's routing profile and models when the session starts (`session.create`; the main session is
created with the reasoning tier's model), and the protocol has no method to change them afterwards. So the pickers show
what applies and set what new sessions get:

- **Profile.** The label is this session's profile. The menu sets the profile new sessions in the workspace start with
  (`workspace.update` with `overrides.routingProfile`, which the engine's default profile reads).
- **Tiers.** The label is the model the reasoning tier resolves to (`models.tiers`, names from `models.list`). The
  menu offers Auto and each model the policy allows, per tier; choosing one writes `routing.tiers.<tier>` to the user's
  `config.jsonc` with `config.set` (A-14, [settings.md](settings.md)) and reloads `models.tiers`. Sessions started
  afterwards use the change. When a managed policy locks `routing.tiers` (`config.get` reports it locked), the menu only
  shows the tiers and names the policy, and a refused write is shown in the status line.

Changing a running session's profile or models needs an engine change (a `session.update`, and re-creating the
runtime session with the new excluded tools and model); it is left for a later unit.

## Performance (§9)

Keystroke to glyph is under 16 ms with a 10,000-event session open. Pica measures it itself with `ComposerMetrics`,
which only the UI tests turn on (`PICA_COMPOSER_METRICS_PATH`), as A-05 does with `TimelineMetrics`. For each key that
types a character it takes the time from the key event's timestamp to:

- **queue**: the composer starting to handle it, and **handle**: how long that took (`keyDown`);
- **commit**: the end of the run loop pass that drew the new glyph, after Core Animation has committed it (a run loop
  observer of order 2,100,000, after Core Animation's at 2,000,000);
- **glyph**: the first display refresh after that commit (the `targetTimestamp` of the display link), the earliest the
  glyph can be on screen.

The report is written once keys stop arriving for half a second. `ComposerLatencyUITests` opens the `timeline`
scenario's 10,025-event session, clicks into the composer and has XCUITest type 120 characters. XCUITest's keys come
through the system's event path, as a keyboard's do, and its typing takes no accessibility snapshots between keys (A-05
had to avoid XCUITest's scrolling for that reason). The check is the 95th percentile of glyph times.

A first version had Pica type into itself with `NSApplication.postEvent`, as A-05's scroll script scrolls. It
measured 13.7–23 ms at p95 while the main thread answered a queued block within 0.3 ms and the composer handled each key
in about 2.4 ms: events an app posts to itself waited 8–10 ms in AppKit's queue before delivery, which no keyboard event
does. So the measurement uses the system's path instead.

Measured on 2026-11-16 (Debug build with the Main Thread Checker, as `xcodebuild test` runs it; Apple silicon at
120 Hz; 120 keys; 10,025-event session open), over six runs:

| | Median | p95 | Max |
|---|---|---|---|
| Glyph (event to first refresh after commit) | 12.9–13.3 ms | 13.5–15.2 ms | 29.3–32.3 ms |
| Commit (event to frame committed) | 9.8–9.9 ms | 11.1–12.2 ms | 14.9–23.2 ms |
| Queue (event to the composer handling it) | 5.6–6.0 ms | 6.4–6.7 ms | 6.7–8.0 ms |
| Handle (the composer's `keyDown`) | 1.6–1.8 ms | 2.6–5.2 ms | 5.3–7.7 ms |

Most of the time is the system delivering the key (queue) and waiting for the display's next refresh; the composer's
own work is about 2 ms. The margin under the budget is small (0.8 ms in the worst run), so a slower machine or more
work per key could fail the check; a Release build without the Main Thread Checker would have more room. Typing does not redraw the timeline, since nothing the timeline observes changes. The maximum
is a single key in each run; which key, and why, is not yet known.
