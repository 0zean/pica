# Session overview (A-16)

One place to see every session and every fan-out run: the board, with the sessions that need the user first, and each
fan-out's aggregate. Code: the feature package `app/Packages/SessionOverview`; the app target opens it as a window and
feeds it the sidebar's store.

## Opening it

Window ▸ Session Overview (⇧⌘O, `showSessionOverview` in A-14's registry, rebindable like any action). It is a window
of its own, like the Usage dashboard and MCP Servers: a board needs more width than the session column, and it stays
open beside the main window. Clicking a session selects it in the main window's sidebar and brings that window
forward, so its timeline (and any approval card) is one click away.

## Engine

No protocol change. The overview reads what the engine already serves:

| Method or event | Used for |
|---|---|
| `session.list`, `session.changed` | Every session and its state, through A-04's `NavigationStore` (the sidebar's store); the board keeps no copy of its own. |
| `workspace.list`, `repo.list`, `workspace.changed` | Workspace names on cards and in the filter, repo names in fan-out runs, also through `NavigationStore`. |
| `fanout.list`, `fanout.changed` | Each fan-out's aggregate (R-11). `fanout.changed` carries the whole aggregate, so a change replaces the fan-out. `fanout.list` is asked again on each connection. |
| `fanout.cancel` | The fan-out card's Cancel button. |

Fan-outs live in the engine's memory (R-11), so the view lists those started since `picad` last started.

## Board

The top section, **Needs You**, is the attention queue: every session that cannot go on until the user acts.

| Order | State | Within the group |
|---|---|---|
| 1 | `awaiting_approval` | Longest waiting first (oldest `updatedAt`) |
| 2 | `failed` | Longest waiting first |

These are the states A-04's sidebar sorts to the top (`SessionState.needsAttention`). The queue is a queue, so it
runs oldest first, where the sidebar shows the most recent first. A card awaiting approval has a warning border.

Under it, the other sessions are in three lanes, most recently updated first:

| Lane | States |
|---|---|
| Working | `starting`, `running` |
| Idle | `idle` |
| Stopped | `resumable` (shown as Interrupted), `ended` |

Every state has exactly one place (`OverviewBoardTests`). A card shows the title, the state chip (the sidebar's words
and tones), the workspace, and when the session last changed. A workspace picker narrows the board and the fan-outs
to one workspace.

`OverviewBoard` is a value worked out from the sessions in the view's body; it holds no state.

## Fan-outs

The Fan-outs tab lists each fan-out run, newest first (`FanOutStore`). A card shows:

- the prompt, the workspace and the concurrency cap;
- the ring (A-03's `ActivityMark`) as progress: settled runs over all runs;
- a counts line, `3 of 6 done · 1 succeeded · 1 failed · 1 cancelled · 1 running · 2 queued`, leaving out zeros;
- the state (Running, Cancelling, Completed, Cancelled) and, while it runs, **Cancel** (`fanout.cancel`);
- a row per repo: its name, its run's status, the error's message for a failed run, and **Open** once the run has a
  session.

A reload that started before a `fanout.changed` keeps the newer aggregate (the same rule as `NavigationStore`).

## Idle cost

PLAN.md §9 gives the app an idle CPU budget of 1% of a core. Nothing on the board moves or ticks while nothing
changes:

- times are drawn as fixed text (time of day, or a date), not a relative time that counts up;
- the fan-out ring is drawn with `isWorking: false`, so its `TimelineView` stays paused;
- the board is recomputed only when SwiftUI sees `NavigationStore` change, and `FanOutStore` assigns only when a
  reload differs.

`OverviewMetrics`, on only with `PICA_OVERVIEW_METRICS_PATH`, measures it: once the board has shown for 3 s
(`PICA_OVERVIEW_METRICS_SETTLE`), it takes the app's own CPU time (`getrusage`, every thread; the engine is another
process) over 10 s (`PICA_OVERVIEW_METRICS_WINDOW`) and writes one JSON report with the sessions on the board, the CPU
fraction, and how many times the board's contents changed meanwhile. `SessionOverviewUITests` makes twenty live
FakeRuntime sessions (four awaiting approval, sixteen idle after a turn), opens the board, and asserts a fraction under
0.01 with no board change. The test does not touch the app while it measures, since accessibility queries cost it CPU.

Measured on 2026-11-21 (Debug build, Apple silicon, other worktree sessions building and testing at the same time):
0.015 s of CPU over 10.6 s, 0.14% of a core.

## Testing

- `OverviewBoardTests`: the queue's order, the lanes, every state placed once, the workspace filter, times.
- `FanOutTests`: the aggregate's runs and counts line, newest first, a change applied, a reload that does not undo a
  newer change, cancelling.
- `OverviewMetricsTests`: off by default, one report per board.
- `server/tests/composition/overview.test.ts`: the `overview` scenario over `picad`'s production composition: one
  message ends idle, two wait for approval, and a fan-out over three repos completes with `fanout.changed` for each
  step.
- `SessionOverviewUITests` (`fake-picad`'s `overview` scenario): sessions awaiting approval are drawn first, ahead of
  newer idle ones; a fan-out reports three successes; a queue card opens its session's approval in the main window;
  and the idle CPU check above. XCUITest returns elements in no particular order, so the test reads the board's order
  from the cards' frames.

## Not done

- No keyboard navigation between cards beyond the system's (Tab and Space).
- Cards name no repos: until R-10 a session's `writeRoots` is empty, so the card cannot say which repo it works in.
- Starting a fan-out: neither the app nor the CLI has a way yet; a client calls `fanout.start`.
