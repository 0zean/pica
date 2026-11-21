# Performance gate (H-07)

Every row of PLAN.md §9 has a test that measures it and asserts its threshold. `make perf` runs those tests, then
reports each budget against its measured value and fails unless every test passed and every budget was measured
under its threshold. The `perf` workflow runs it on the reference runner for every pull request that touches `app/`,
`engine/`, `tools/perf/`, the `Makefile` or the workflow, and puts the report in the job summary.

## Budgets

The registry is `tools/perf/budgets.json`: one entry per §9 row, with the row's words, an id, the threshold the test
asserts, its unit, the statistic and the test. `engine/tools/perf-report/report.test.ts` checks it has exactly one
entry per §9 row with the row's own words, so a new or changed row in PLAN.md fails `make verify` until it has a
test. Two entries marked `extra` are not §9 rows but unit timing checks the gate also reports (A-09's ranker alone,
A-01's engine recovery).

### Measured

Reference Mac: Apple M2 Pro, 10 cores, 16 GB, macOS 27.2, Debug build, 2026-11-21, `lockf /tmp/pica-uitest.lock make perf`
with other worktree sessions idle (load averages 3–10 while measuring). GitHub runner: `macos-26`, an Apple M1 virtual
machine with 3 cores and 7 GB, two `perf` runs on this PR (load averages up to 42 when the run started).

| §9 budget | Test | Threshold (statistic) | Reference Mac | GitHub runner, runs 1 / 2 |
|---|---|---|---|---|
| App cold launch to interactive window | `LaunchPerformanceTests` | < 1000 ms (median of 5) | 636 ms | 1195 / 891 ms |
| Engine start to `engine.hello` reply | `startup-benchmark.test.ts` | < 1500 ms (median of 3) | 310 ms | 704 / 477 ms |
| Keystroke to glyph in composer | `ComposerLatencyUITests` | < 16 ms (p95 of 120) | 13.4 ms | 31.0 / 31.2 ms |
| Open a 10,000-event session | `TimelineUITests` | < 300 ms (median of 5) | 228 ms | 912 / 514 ms |
| Timeline scroll hitch time ratio | `TimelineUITests` | < 1% | 0.00% | 0.98 / 7.66% |
| Render a 5,000-line diff | `ReviewUITests` | < 200 ms (median of 3) | 66 ms | 98 / 94 ms |
| Quick open over 100,000 files | `quick-open-benchmark.test.ts` | < 50 ms (slowest keystroke) | 18.6 ms | 37.6 / 33.5 ms |
| Event delivery engine → view, p99 | `EventDeliveryLatencyTests` | < 5 ms (median of 3 p99s) | 0.97–1.19 ms (one run at 10.5 ms, below) | 2.84 / 10.56 ms |
| App idle CPU with 5 idle sessions | `ResourceBudgetUITests` | < 1% of a core | 0.27% | — / 0.48% |
| App memory with 5 sessions of 2,000 events | `ResourceBudgetUITests` | < 300 MB | 83 MB | — / 61 MB |
| Policy decision, p99 | `policy/benchmark.test.ts` | < 1 ms | 0.006 ms | 0.012 / 0.012 ms |
| *Quick-open ranker alone (A-09)* | `files/benchmark.test.ts` | < 50 ms | 22.0 ms | 34.2 / 28.4 ms |
| *Engine recovery (A-01)* | `EngineRecoveryTests` | < 2000 ms (median of 3) | 425–1459 ms | 630 ms / — |

Runner 1's idle CPU and memory were not measured (the test clicked a sidebar row the runner reported as not hittable;
it now selects with ⌘1–⌘5), and run 2's engine recovery was skipped after event delivery failed (each is now its own
step). On the reference Mac every budget passed, event delivery after a rerun: in one full run its p99s were 8–13 ms,
and three runs of it alone straight after measured median p99s of 0.97, 1.19 and 0.99 ms. That is why the gate retries
that step once. The idle CPU budget failed in the first local run (1.56%) because the timeline's and composer's frame
metrics each run a display link on every frame; the test now turns them off, since they are the tests' cost.


## How each one is measured

- **Launch, timeline, composer, diff.** The app measures itself while a UI test drives it (`LaunchTiming`,
  `TimelineMetrics`, `ComposerMetrics`, `ReviewMetrics`, each on only when its `PICA_*_METRICS_PATH` is set), as
  their units specify (docs/app-shell.md, docs/session-timeline.md, docs/composer.md, docs/review.md). UI tests run a
  Debug build, so the numbers are an upper bound for a release build.
- **Engine start, quick open, policy.** vitest benchmarks in the engine. Quick open is measured twice: the ranker
  alone in CPU time, and `files.quickOpen` over the socket in wall time, which is the §9 row.
- **Event delivery (new).** `EventDeliveryLatencyTests` (AppShell) has the app's supervisor start
  `event-latency-picad.ts`: `picad`'s production composition with a FakeRuntime whose runtime, when sent
  `stream <count> <rate>`, emits paced assistant deltas that each carry `process.hrtime` at the moment of emission.
  The test reads `CLOCK_MONOTONIC_RAW` on the main actor as each decoded event arrives there, which is where the
  app's stores apply events. On macOS both clocks read `mach_continuous_time`; the test fails if a delta seems to
  arrive before it was sent. A delay therefore covers the engine (normalizing, storing, notifying), the socket,
  `EngineClient`'s decoding and the hop to the main actor. Deltas are paced (500/s, faster than a model streams) so
  each one measures one event's way and not a queue behind a burst. S-07's spike measured the same budget on a
  prototype; this measures the product.
- **Idle CPU and memory (new).** `ResourceBudgetUITests` makes five sessions that each play the `resources`
  scenario (one turn of about 2,000 events), opens every one in the main window so each timeline is loaded, waits
  3 s, and asks the app to measure itself: a request file next to `PICA_RESOURCE_METRICS_PATH` makes
  `ResourceMetrics` (AppShell) measure its CPU time (user and system, every thread) over 10 s and its physical
  footprint, which is what Activity Monitor's Memory column shows. It waits on a kqueue source, so waiting costs
  nothing, and nothing touches the app while it measures, since accessibility queries cost the app CPU. The engine is
  another process and is not counted in either.
- **Engine recovery (A-01, not §9).** Now the median of three kills in one run; each kill restarts the engine at once
  (the supervisor's restart delays apply only to failed starts).

## Stable measurements

- **Statistics.** A single sample decides nothing that a scheduler hiccup can decide: launch, engine start, timeline
  open, diff render and engine recovery take medians; quick open takes each keystroke's median of three typings and
  then the slowest keystroke; event delivery takes the median of three runs' p99, after a warm-up run. The composer's
  test asserts the p95 of 120 keystrokes, as A-06 set it; the gate reports that p95. No budget's threshold changed.
- **No competing work inside the gate.** `make perf` runs the engine benchmarks one test file at a time
  (`--no-file-parallelism`), the Swift suites one `swift test` per suite (it runs a package's suites in parallel),
  and the UI tests one after another. It builds each part before measuring it, then waits (at most 3 minutes) until
  the one-minute load average is under the CPU count, and records the load it started at.
- **One retry, shown.** Event delivery and engine recovery are retried once after settling again if they fail; the
  first attempt's value is in the report's notes. UI tests are not retried.
- **Event delivery outside the gate.** `EventDeliveryLatencyTests` runs only with `PICA_PERF_GATE=1`: in
  `verify-app`, `swift test` ran it beside AppShell's other suites on a 3-core runner and measured them (p99 7.6 ms).
- **The budget as written, also on CI.** `PICA_PERF_GATE=1` makes A-09's tests assert 50 ms even with `CI=true`.
  Outside the gate, `verify-engine` on shared Linux runners still asserts three times it as a regression guard
  (A-09's note); that is not the gate. The report fails a budget whose test recorded a different threshold or unit
  than the registry, so a test cannot loosen a budget without the registry, and so the review, showing it.
- **Locally.** Run it alone and under the UI-test lock: `lockf /tmp/pica-uitest.lock make perf`. The report ends with
  the machine and its load averages before and after the run.

## Reference runner

There are two, and only one of them can hold every budget today.

- **The reference Mac** is the gate as PLAN.md §8.1 already treats `make verify`: an Apple silicon Mac (measured on an
  M2 Pro) with nothing else running, `lockf /tmp/pica-uitest.lock make perf`. Every budget passes there.
- **The GitHub runner** (`perf` workflow, `macos-26`: an M1 virtual machine with 3 cores) runs the same `make perf`
  on every pull request. It holds the engine budgets, the diff render, idle CPU and memory. It does not hold five
  budgets: cold launch, keystroke to glyph and opening a 10,000-event session are over budget on every run, and scroll
  hitch ratio and event delivery are under budget on one run and over on the next. The workflow names those five in
  `PERF_NOT_GATING`, so they are measured and shown as over budget in the summary without failing the job. The
  thresholds are unchanged, and `make perf` without that variable gates on all of them.

**Owner decision (open).** Either keep the GitHub runner as CI's gate with that list (the reference Mac stays the
gate for the five), add a self-hosted Apple silicon runner as the reference runner and drop the list, or measure a
Release build of the UI tests and see whether the runner then holds them. H-07's box stays unticked until then.


## Files

- `tools/perf/budgets.json`: the registry. `tools/perf/run.sh`: what `make perf` runs.
- `engine/tools/perf-report/`: the report and its tests.
- `engine/tests/support/budget-record.ts`, `app/Packages/AppShell/Tests/AppShellTests/BudgetRecord.swift`: tests
  write `<id>.json` to `PICA_PERF_DIR` when the gate sets it.
- `app/PicaUITests/BudgetAttachment.swift`: UI tests attach `budget-<id>.json` to their result instead, which the gate
  exports with `xcresulttool export attachments`.
- `.github/workflows/perf.yml`: the CI job, which uploads the measurements and the UI-test result bundle.
