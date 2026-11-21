# C-11: the 5% reasoning-input gate against run-to-run spread

*Update, same day: the owner chose (b2). It is recorded in D-21, and the rerun is in [`2026-11-21-c11-b2-live.md`](2026-11-21-c11-b2-live.md).*

Offline analysis, 2026-11-21. No live session was run. It uses the per-run data already committed in
[`2026-11-16-c10-live.json`](2026-11-16-c10-live.json) and [`2026-11-17-c11-live.json`](2026-11-17-c11-live.json):
Copilot Pro, reasoning pinned to `gpt-5.6-luna`, 3 runs of 15 tasks per profile.

It prepares two ways to judge D-21's reasoning-input limit (at most 5% more than `off`, on the mean of
3 runs) now that the limit is known to sit inside the noise. **Choosing one, and recording it in D-21,
is the owner's decision.** D-21's gate and `regressionGate` in `engine/packages/evals/src/report.ts`
are unchanged.

## How big the spread is

"Reasoning input" is fresh plus cached input of reasoning-tier calls, summed over the 15 tasks. A
"suite run" is run *k* of every task.

| Report | Profile | Suite run 1 | Suite run 2 | Suite run 3 | Mean | SD across suite runs |
|---|---|---|---|---|---|---|
| C-10, 2026-11-16 | `off` | 996,588 | 997,115 | 1,037,269 | 1,010,324 | 2.3% |
| C-10, 2026-11-16 | `balanced` | 1,206,342 | 1,076,388 | 1,092,327 | 1,125,019 | 6.3% |
| C-11, 2026-11-17 | `off` | 1,018,670 | 1,121,703 | 1,055,087 | 1,065,153 | 4.9% |
| C-11, 2026-11-17 | `balanced` | 1,201,070 | 1,210,064 | 1,052,910 | 1,154,681 | 7.6% |

The SD over three suite runs is itself noisy. Pooling each task's variance over its 3 runs gives a
steadier per-run suite SD: `off` 5.1% and `balanced` 4.9% (C-10), `off` 5.8% and `balanced` 7.4%
(C-11). One task, `console-to-logger`, has a per-run SD of 46k under `off` alone, about 4% of the suite.

Three facts follow:

- **`off` against itself, a day apart, moved +5.4%** (1,010,326 on 2026-11-16, 1,065,153 on 2026-11-17;
  credits +6.4%). `off` has no delegation guide, cost gates or limits; of C-11's changes it sees only
  `code-writer`'s longer description in the `task` tool, a few dozen tokens per turn, and it delegated
  to none of Pica's agents on either day (its only worker calls ran on Copilot's own `copilot-search-a`). So `off` all but unchanged would fail a 5% gate against itself.
- **An `off`-against-`off` split fails 5% often.** Pool the 6 `off` runs of each task from both days,
  split them at random 3 against 3 (20,000 splits): the median gap is 3.2%, one side is more than 5%
  above the other 15% of the time, and the 95th percentile is +8.0% (97.5th: +9.5%).
- **C-11's +8.4% is about 1.6 standard errors.** With C-11's spread, the standard error of the
  `balanced`-minus-`off` gap at 3 runs is 5.4% of `off`. A `balanced` that truly used exactly as much
  as `off` would fail the 5% gate about 18% of the time. Against the 6 pooled `off` runs, C-11's
  `balanced` is +11.3%, so the excess is more likely real than noise, but 3 runs can't settle it.

These are estimates from 3 runs per cell. They assume tasks vary independently and the gap is roughly
normal; treat the probabilities as ±a few points.

## Option (a): keep the 5% limit, run more than 3 times

Same gate, same comparison of means, more runs per profile (`EVAL_RUNS=n`). One suite run costs about
6.6 credits under `off` and 8.4 under `balanced` (C-11 report), so about 15 credits per run of both.

| Runs per profile | Credits (both profiles) | SE of the gap | Fails if `balanced` = `off` | Fails if `balanced` is truly +2.5% |
|---|---|---|---|---|
| 3 (today) | ~45 | 5.4% | ~18% | ~32% |
| 5 | ~75 | 4.2% | ~12% | ~28% |
| 6 | ~90 | 3.8% | ~10% | ~26% |
| 8 | ~120 | 3.3% | ~7% | ~23% |
| 10 | ~150 | 3.0% | ~5% | ~20% |
| 15 | ~225 | 2.4% | ~2% | ~15% |

Figures use C-11's spread, the wider of the two reports; with C-10's they are a little better (10 runs:
SE 2.2%, ~1% false fail).

- **Evidence it gives:** the mean excess itself, measured closely enough to compare with 5%. A pass at
  10 runs says `balanced`'s true excess is very likely under about 10%, and its best estimate is under 5%.
  The gate keeps its meaning: "at most 5% more".
- **What it costs:** about 150 credits for a 5% false-fail rate, over 3 times the 3-run suite. The live
  test's default stop, `EVAL_MAX_CREDITS=80`, would have to be raised (for 10 runs, to about 160).
- **Limits:** a `balanced` that is truly 2–4% over still fails a good share of the time, since 5% is
  only 1.5–2 SE away even at 10 runs. Wall time grows too: about 8 minutes per run of both profiles.

## Option (b): set the margin from `off` against itself

Keep 3 runs of `balanced`, but replace the fixed 5% with the gap that `off` shows against itself: the
95th percentile of a 3-against-3 split of `off` runs, taken on the same day, build and CLI version.

Two ways to get that spread:

| Variant | What runs | Credits | Margin it gives |
|---|---|---|---|
| (b1) from the committed data | nothing new | 0 | +8.0% (95th percentile of the pooled 6 `off` runs, 2026-11-16 and 11-17). It mixes two days, so it includes the +5.4% day-to-day move and is wider than a same-day margin. |
| (b2) measured with the rerun | `off` 6 runs and `balanced` 3, one sitting: `EVAL_PROFILES=off EVAL_RUNS=6`, then `EVAL_PROFILES=balanced EVAL_RUNS=3` | ~65 (6 × 6.6 + 3 × 8.4) | The same statistic from 6 same-day `off` runs, compared with `balanced` against the mean of all 6. From the per-task spread above, expect roughly +7% to +8%. |

- **Evidence it gives:** that `balanced`'s excess is within what `off` differs from itself on this
  suite. It does not bound the excess at 5%: a `balanced` that is truly about 5–7% over can pass.
  The gate then means "no regression we can tell apart from noise at this run count", not "at most 5%".
- **What it costs:** nothing for (b1), about 65 credits for (b2), against about 45 for the 3-run suite
  as it stands.
- **On today's data:** C-11's +8.4% is just over b1's +8.0% margin, and +11.3% against the pooled
  `off` runs. So (b) would not have passed C-11 either; it changes what a pass means, not this result.
- **Limits:** a margin estimated from 6 runs is itself uncertain (its 95th percentile moves by a
  point or two between draws), and the report would need the margin and how it was derived recorded
  next to the result. `compareProfiles` takes the margin from `regressionGate`, so the harness would
  need the margin passed in, or the comparison redone by hand from the JSON.

## Side by side

| | (a) more runs | (b1) margin from committed data | (b2) margin measured on the day |
|---|---|---|---|
| Credits for the next live check | ~150 (10 runs) | ~45 (3 runs, as today) | ~65 |
| Gate's meaning | at most 5% more, measured | within `off`'s own 3-run spread (~8%) | within `off`'s same-day 3-run spread |
| False fail if `balanced` = `off` | ~5% | ~5% by construction | ~5% by construction |
| Passes a true +5–7% excess | rarely | often | often |
| Harness change | none (raise `EVAL_MAX_CREDITS`) | a configurable margin, or a manual check | a configurable margin and an `off`-only A/A summary, or a manual check |
| Would C-11's 2026-11-17 result pass | unknown until rerun | no (+8.4% against 8.0%) | unknown until rerun |

## Method

For each report and profile, per task: the variance of reasoning input over its 3 runs. The suite's
per-run variance is the sum over tasks. The SE of the gap of means at *n* runs is
√((var<sub>off</sub> + var<sub>balanced</sub>) / n), as a share of `off`'s mean. The false-fail rate is
P(Z > 5% / SE). The `off`-against-`off` figure pools each task's 6 `off` runs from both reports and
draws a random 3-against-3 split per task, 20,000 times, comparing the summed totals.
