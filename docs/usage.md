# Usage and cost (A-11)

What a session and a period cost: the session chip over the timeline, the Usage dashboard window, the savings
estimate, and budget warnings. Code: the feature package `app/Packages/Usage`; the app target wires it into the
timeline's header and opens the dashboard. The figures come from C-08's ledger (`usage.rollup`) and the session's
events; C-09 owns the budgets themselves.

## Engine

No protocol change. The production composition already serves what A-11 reads:

| Method or event | Used for |
|---|---|
| `usage.rollup {groupBy, from?, to?, workspaceId?, sessionId?}` | Every dashboard chart and total, and the chip's breakdown. `from` is inclusive, `to` exclusive; `day` keys are UTC days (`YYYY-MM-DD`). The `savings` it returns covers the same records as its rows. |
| `workspace.list` | Workspace names for the `workspace` rollup's keys, and the dashboard's workspace filter. |
| `config.get budget.workspaceDailyCredits` | The daily cap the dashboard warns against (default 3,000). |
| `usage.recorded`, `context.usage` events | The chip's tokens, credits and context use, as A-05's `TimelineStore` already sums them. |
| `session.changed` (`budgetCredits`) | The chip's budget limit. Raising a budget through its approval moves the session out of `awaiting_approval`, which broadcasts the new limit. |

## Session chip

The bar over the timeline (A-05's header) shows one chip: `Context 42% · 18.3K tokens · 1.2 of 300 credits`. Without a
budget limit the credits part is `1.2 credits`; without a `context.usage` event yet, context is `–`. In a narrow column
the chip shrinks to its context figure, then to nothing, so it never sets the column's minimum width (as A-05's did).

The chip's tone is the worse of two fractions, each against C-09's default warning thresholds (0.75 and 0.9):

| Fraction | Below 0.75 | 0.75 to 0.9 | 0.9 and over |
|---|---|---|---|
| Context: `currentTokens / tokenLimit` | neutral | warning | danger |
| Budget: credits spent / `budgetCredits` | neutral | warning | danger |

Clicking the chip opens a popover with the session's breakdown: input (cached), output and context tokens; credits
against the limit, as a bar; credits by agent and by model (`usage.rollup` with `sessionId`); the savings estimate; and
**Open Usage Dashboard**. The breakdown is asked for each time the popover opens.

Timeline keeps summing the events; it takes the chip as a view from the app target (`usageChip:`), since features do
not depend on each other (PLAN.md §4.3). Its own plain A-05 chip is drawn only when it is given none, as in its snapshot
tests.

## Dashboard

A window, **Window ▸ Usage Dashboard** (⇧⌘U, `showUsage` in A-14's registry; rebindable). Two filters:

- **Period:** Today, Last 7 Days (the default) or Last 30 Days. Periods are whole UTC days ending with today, matching
  the ledger's `day` rollup: Last 7 Days is `from` today − 6 days 00:00 UTC to `to` tomorrow 00:00 UTC.
- **Workspace:** All Workspaces, or one. A filter adds `workspaceId` to every rollup.

It shows, top to bottom:

1. **Totals:** credits, tokens (input + output, with cached input in the tile's caption), and model calls.
2. **Estimated savings** (see below).
3. **Budget warnings,** one row per workspace whose spend today reaches 75% of `budget.workspaceDailyCredits`:
   warning tone from 75%, danger from 90%; at 100% the row says new sessions are blocked until 00:00 UTC (C-09
   checks the cap when a session starts or resumes). These ignore the period filter: the cap is per UTC day. The
   workspace filter limits them to that workspace. A workspace's `overrides.dailyCredits` is stored but not enforced
   by the engine yet (the workspace config layer is not composed), so the dashboard warns against the config's cap.
4. **Credits by day:** a bar per UTC day of the period, days without usage at zero.
5. **By model, by agent, by workspace:** horizontal bars of credits, largest first, with calls and tokens beside each.
   At most eight bars; the rest are summed as **Other**. With a workspace filter, the by-workspace chart is hidden.

The dashboard asks again when a filter changes, when the window becomes key, and from its Refresh button (⌘R). Every
rollup of one load is sent together; one that fails shows the error in place of the charts and keeps the filters.

Charts are Swift Charts (no new dependency). Workspace keys are shown by name; a deleted workspace shows its id.

## Savings estimate

PLAN.md §5.6: worker-tier tokens repriced at the reasoning tier's rates, minus what they cost. The engine computes it
(C-08), and the protocol types it as `estimated: true`. Pica shows it only through `SavingsFigure`, whose title is
always **Estimated savings** and whose footnote explains how it is estimated, so the figure cannot appear without the
word. A negative estimate (workers that cost more than the reasoning tier would have) is shown as it is. The snapshot
tests assert the label on the dashboard and in the chip's popover.

## Tests

- View-model tests (`UsageDashboardTests`, `SessionUsageTests`) read `Tests/UsageTests/Fixtures/ledger-rollups.json`:
  `usage.rollup`'s answers over a fixed ledger of three workspaces, five sessions, four agents, three models and nine
  UTC days. `engine/packages/server/tests/usage/app-fixtures.test.ts` builds that ledger, asks the engine, and checks
  the file still matches (`PICA_UPDATE_FIXTURES=1` rewrites it).
- Snapshot tests (`UsageSnapshotTests`) draw the dashboard from the fixtures in light, dark and increased contrast, the
  chip in each tone, and the popover. `ImageRenderer` drawings have no accessibility tree, so each drawing that holds
  the savings figure is read back with Vision's text recognition, and the test fails if "savings" appears anywhere
  without "Estimated savings". macOS 26 references come from CI's artifact.
- `UsageUITests` runs `fake-picad`'s `usage` scenario (a main-agent call, a `bulk-reader` call and a context report):
  the chip's figures, its popover and the dashboard (from the popover and from ⇧⌘U), each with the savings figure's
  accessibility label starting "Estimated savings".
