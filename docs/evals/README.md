# Eval reports (C-10)

The eval harness (`engine/packages/evals`) runs a fixed suite of 12 tasks once per routing profile and
writes a JSON report and a Markdown report. It measures reasoning-tier input tokens, credits, wall time,
and task success. PLAN.md §5.6 describes the measurement.

## The suite

The tasks run over two fixture repos in `fixtures/evals/`. Most of their content is generated,
deterministically, by `engine/packages/evals/src/large-files.ts` and `generated-modules.ts`.

### Sizing

The inputs are sized from the 2026-11-16 smoke runs on Copilot Pro.

**What a turn costs.** Every main-agent turn carries a cached prompt prefix of about 16–18k tokens.
Delegating adds about three main-agent turns: the attempt, the hand-off, and the review. That is
roughly 50k tokens of reasoning-tier input.

**Why the old suite lost.** Its files were a few KB. Under `off`, the main agent read them for less
than those extra turns cost, so `balanced` came out 45% *more* expensive.

**What the target needs.** For `balanced` to use 60% less, `off` has to cost at least 2.5 times as
much. That happens when the `off` main agent carries about 20–25k tokens of content through about
five turns. 20–25k tokens is roughly 80–100 KB of input that the task really needs read. The inputs
are:

| Input | Size | Used by |
|---|---|---|
| `db/schema.sql`, `logs/settlement.log`, `src/generated/error-codes.mjs` | 222 KB, 494 KB, 132 KB | Large-file questions |
| `src/money.mjs` | 92 KB | `money-tests` |
| `src/slug.mjs`, `src/retry.mjs` | 87 KB each | `slug-tests`, `backoff-tests` |
| `docs/services.md` (65 services) | 80 KB | `service-ports` |
| 35 ledger modules (`src/reports/` and others) | 90 KB | `rename-fmt-cents`, `console-to-logger` |
| 36 toolkit modules | 145 KB | `license-headers`, `prettier-config` |

**What size can't control.** A model can still answer a needle question with `grep`, or make a
mechanical edit with one `sed`, in either profile. Size makes delegation pay only where the main
agent really has to hold the content.

| Category | Tasks | Success check |
|---|---|---|
| Large-file question | `schema-column-owner`, `settlement-log-error`, `error-code-value` | The main agent's last message names the needle |
| Test scaffolding | `money-tests`, `slug-tests`, `backoff-tests` | The new test file has enough cases. It passes on the code and fails on a broken copy of it |
| Config generation | `tsconfig`, `prettier-config`, `service-ports` | The file parses and has the required settings |
| Multi-file edit | `rename-fmt-cents`, `console-to-logger`, `license-headers` | The change is complete, nothing else changed, the modules load and the tests pass |

Every task also has a reference solution. `checks.test.ts` proves each check passes on its reference
solution and fails on an untouched fixture.

## Runs per task

Each task runs several times per profile: 3 in the live run, set by `EVAL_RUNS`. The report gives
the mean and the per-run range for each task and profile. The 60% check and the at-most-one-fewer
check use the means.

## How a run works

The harness runs each task in a fresh engine with the production composition (E-11). Each engine gets
its own Pica data directory, a fresh git copy of the fixture, and `permissions.mode: "auto"`. The cost
gates still apply, because they run before the permission mode.

The harness sends the task's prompt and waits for the turn to end. Along the way it approves tool
calls and declines budget raises. It then runs the task's success check. The numbers come from the
usage ledger (C-08), grouped by tier.

"Reasoning input" counts both fresh and cached input tokens, because both fill the reasoning model's
context. The report also lists which models each tier's calls actually ran on.

## Running it

The deterministic golden test runs against FakeRuntime. It runs in `make verify-engine`:

```bash
make verify UNIT=C-10
```

The live run needs a Copilot CLI login and spends Copilot quota. It writes `docs/evals/<date>-c10-live.json`
and `.md`, which get committed. It leaves the signed-in user's Pica data untouched.

```bash
cd engine && PICA_LIVE=1 pnpm exec vitest run packages/evals/tests/live-suite.test.ts
```

To run only some tasks, set `EVAL_TASKS=schema-column-owner,money-tests`.

On a default-model-only plan such as Copilot Free, sub-agents run on the same model as the main agent
(D-16). There, delegation moves tokens from the reasoning tier to the worker tier, but it cannot lower
credits. When no worker-tier call ran on a model of its own, the report says so.
