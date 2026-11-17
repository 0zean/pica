# Session timeline (A-05)

The session column shows the selected session's timeline (PLAN.md §7.2). The code is in `app/Packages/Timeline`, a
feature package with the same layering rule as the others (§4.3: it depends on `EngineClient`, `PicaProtocol` and
`DesignSystem`). Features do not depend on each other, so AppShell's `SessionColumn` draws a selected session with a
`SessionContent` closure that the app target supplies: `PicaApp` passes `SessionTimelineScreen`, and AppShell's own
tests and previews use `SessionColumn.placeholder`. The checks are
`TimelineSnapshotTests`, `TimelineStoreTests`, `ScrollFollowTests`, `FrameClockTests` and `MarkdownDocumentTests` in
the package, and `TimelineUITests` in `app/PicaUITests`.

## Data flow

EngineClient → store → view (§8). `SessionTimelineScreen` owns one `TimelineStore` per session (the column gives it
`.id(sessionId)`), and while it is on screen it follows `EngineClient.events(sessionId:afterSeq:)` from the store's
last `seq`. The client resumes after a reconnect at `seq + 1`, and the store also ignores any `seq` it has applied.

- **Batching.** The store reads the stream off the main actor into a buffer and applies whatever has accumulated in
  one main-actor turn, so a 10,000-event history or a fast stream costs a few view updates, not one per event.
- **Opening.** The session's `lastSeq` from the sidebar is the history to load. Until the store has applied that
  many events the column shows a loading state; then the list is built once, scrolled to the newest row.
- **Rows.** Each row is an `@Observable` item, so a streaming delta or a tool's result redraws only its row; the list
  of rows changes only when a row is added.

## Rows

| Events | Row |
|---|---|
| `user.message` | The message in a card; steer and queue are marked. |
| `assistant.delta`, `assistant.message` | One message per `messageId`, rendered as Markdown. Deltas append; the whole message replaces them. |
| `tool.started`, `.completed`, `.failed` | One compact row per call: status, tool, main argument, result size. A click shows arguments, result preview, error, spill path and the policy decision. |
| `subagent.*` | A collapsed group: agent, model (marked when it differs from the one requested), duration and tokens. It takes the row of the `task` call that started it, and holds the rows the sub-agent produced: those whose `parentToolCallId` is the group's call, or whose agent is the running sub-agent. |
| `policy.decision` | Attached to its tool call. A deny, ask or rewrite also gets an inline row with the rule and reason. |
| `approval.requested`, `.resolved`, `budget.exhausted` | An inline approval row, pending or with the user's choice. A budget approval announced by both events is one row. A-07 adds the choices. |
| `budget.warning`, `session.aborted`, `session.error` | A one-line notice. |
| `session.state_changed` | Updates the state; only `failed`, `ended` and `resumable` get a notice. |
| `usage.recorded`, `context.usage` | The header chip: context use, tokens (input + output) and credits. |
| `runtime.unknown`, an unknown type | A notice that expands to the raw event. |

### Markdown

Assistant text is parsed with [swift-markdown](https://github.com/swiftlang/swift-markdown) (Apple's, on cmark-gfm),
the Markdown parser in §8's expected set. It parses GitHub-flavored Markdown (tables, strikethrough) into a typed tree,
which `MarkdownDocument` turns into blocks: headings, paragraphs, lists, quotes, code blocks, tables and rules, with
inline formatting kept as `inlinePresentationIntent` and links, which `Text` draws as they are. Foundation's
`AttributedString(markdown:)` was the alternative without a dependency, but its block structure comes as flat
presentation intents per run that would have to be regrouped by hand, and it has no tables.

Streaming text is parsed whole on each change, and only for rows on screen (a message parses on first use and again
only after its text changed). An unclosed code fence runs to the end of the text, so a half-written message is a valid
document. Parsing the 668 messages of the 10,000-event fixture takes about 50 ms in all in a Debug build.

### Selection

Rows are not selectable. Selectable text made each row several times slower to build, which showed as a 10% hitch
ratio while scrolling. Messages have a Copy item in their context menu, and the expanded details of a tool call or an
unknown event are selectable, since they are built only when opened.

## Scrolling

The list is a `ScrollView` over a `LazyVStack`, which builds only the rows near the viewport. SwiftUI's `List` was
tried first: while scrolling through the 10,000-event fixture it stalled for about 50 ms at a fixed point, when it
re-estimated the rows' heights, and missed the hitch budget.

The timeline follows the newest row while the user is at the bottom (`ScrollFollow`). Scrolling up stops it, so rows
arriving then do not move what the user is reading; scrolling back to the bottom starts it again. Only a change of the
offset alone counts as the user's scrolling: when the content or the viewport changes size the offset may move with
it, and that says nothing about where the user wants to be.

## Performance (§9)

`TimelineMetrics` measures the timeline from inside the app. It is on only when `PICA_TIMELINE_METRICS_PATH` is set,
as the UI tests do, and writes a JSON report there:

- **Open:** from the store's creation, when the session is selected, to the run-loop turn after the list first
  appeared with the whole history applied, which comes after that frame was committed. Also the time to the first
  event and to the last one.
- **Hitches:** from display-link callbacks while the offset is changing. A frame shown more than half a frame after
  the time the previous callback was given for it is a hitch, and is late by the difference; the hitch time ratio is
  the late time over the scrolling time, as XCTest's hitch metrics define it.
- **Scroll geometry and the last `seq` applied**, which the streaming test reads.

With `PICA_TIMELINE_SCROLL_SCRIPT=1`, Pica scrolls the timeline itself two seconds after a session opens
(`ScrollScript`): 9,600 points up at 2,400 points a second and back, moving by the time since the last frame as
momentum scrolling does. XCUITest's own scrolling jumps a page per event, and its accessibility queries after every
action hold the app's main thread for tens of milliseconds to seconds, which would be counted as hitches.

The fixture is `fake-picad`'s `timeline` scenario (`PICA_TEST_SCENARIO=timeline`,
`engine/packages/server/tests/processes/fake-picad-scenarios.ts`): its first turn writes 10,025 events through the
production composition (1,671 rows); later turns stream a follow-up message each. Measured on 2026-11-16 on an Apple
silicon Mac, Debug build: open median 0.21–0.22 s (history applied after about 0.19 s), hitch time ratio 0.1–0.3%.

`EngineClient`'s line splitter looked for newlines with `firstIndex(of:)`, one generic call per byte in a Debug
build; a 10,000-event replay took 0.69 s there (0.18 s in Release). It uses `memchr` now: 0.20 s.

Event delivery from engine to view (p99 < 5 ms) belongs to S-07 and A-02 and is not measured here.
