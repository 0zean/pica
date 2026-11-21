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

MEASURED_TABLE

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
  (`--no-file-parallelism`), and the Swift and UI tests one after another.
- **The budget as written, also on CI.** `PICA_PERF_GATE=1` makes A-09's tests assert 50 ms even with `CI=true`.
  Outside the gate, `verify-engine` on shared Linux runners still asserts three times it as a regression guard
  (A-09's note); that is not the gate. The report fails a budget whose test recorded a different threshold or unit
  than the registry, so a test cannot loosen a budget without the registry, and so the review, showing it.
- **Locally.** Run it alone and under the UI-test lock: `lockf /tmp/pica-uitest.lock make perf`. The report ends with
  the machine and its load averages before and after the run.

## Reference runner

REFERENCE_RUNNER

## Files

- `tools/perf/budgets.json`: the registry. `tools/perf/run.sh`: what `make perf` runs.
- `engine/tools/perf-report/`: the report and its tests.
- `engine/tests/support/budget-record.ts`, `app/Packages/AppShell/Tests/AppShellTests/BudgetRecord.swift`: tests
  write `<id>.json` to `PICA_PERF_DIR` when the gate sets it.
- `app/PicaUITests/BudgetAttachment.swift`: UI tests attach `budget-<id>.json` to their result instead, which the gate
  exports with `xcresulttool export attachments`.
- `.github/workflows/perf.yml`: the CI job, which uploads the measurements and the UI-test result bundle.
