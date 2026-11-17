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
whose query is no longer the one being typed is dropped. Items are ranked by prefix match, then a match at a word
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
- **Tiers.** The label is the reasoning tier's setting and the model it resolves to (`models.tiers`). The menu sets
  `auto` or a model the policy allows (`models.list`) for each tier, in the user's config (`config.set
  routing.tiers.<tier>` at the `user` layer). Sessions started afterwards use it.

Changing a running session's profile or models needs an engine change (a `session.update`, and re-creating the
runtime session with the new excluded tools and model); it is left for a later unit.

## Performance (§9)

Keystroke to glyph is under 16 ms with a 10,000-event session open. Pica measures it itself with `ComposerMetrics`,
which only the UI tests turn on (`PICA_COMPOSER_METRICS_PATH`), as A-05 does with `TimelineMetrics`. For each key that
types a character it takes the time from the key event's timestamp to:

- **commit**: the end of the run loop pass that drew the new glyph, after Core Animation has committed it (a run loop
  observer of order 2,100,000, after Core Animation's at 2,000,000);
- **glyph**: the first display refresh after that commit (the `targetTimestamp` of the display link), the earliest the
  glyph can be on screen.

`ComposerLatencyUITests` opens the `timeline` scenario's 10,025-event session, clicks into the composer and lets Pica
type 120 characters into it itself (`PICA_COMPOSER_TYPING_SCRIPT`), one every 100 ms through the window's event queue
like any key. XCUITest's own typing waits on accessibility snapshots that hold Pica's main thread, which would be
counted against the composer. The check is the 95th percentile of glyph times.

MEASUREMENTS
