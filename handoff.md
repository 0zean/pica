# Session Handoff — H-05, H-06, H-07 and C-11 landed

## Where it started
After A-15, A-16, X-01 and X-02 landed, the owner asked to continue the remaining open units in parallel sessions, then to merge all the PRs. They'll complete M4 once they can install the app. Each unit ran in its own worktree session. All four PRs are merged into `main`, landed in the order #110, #107, #108, #109; `main` is at `f927dcb`. H-08 waits on M4.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/110 (H-06 Distribution, done):** spec in `docs/distribution.md`.
  - **Release:** `tools/release/` (`build.sh` / `make release VERSION=x.y.z`, `package.sh`, `sign.sh`, `appcast.sh`, `install.sh`, `notarize.sh`, `check-*.sh`). `.github/workflows/release.yml` runs on `workflow_dispatch` with a `version` input. It creates or refreshes a **draft** release with `SHA256SUMS`, `install.sh` and, once a key exists, `appcast.xml`. It never publishes or tags.
  - **Engine bundle:** `engine/tools/bundle` makes one `picad.mjs` with esbuild 0.28.2, the one new engine dependency. `ENGINE_VERSION` moves to `server/src/version.ts` and is stamped at build.
  - **Updates:** the new `app/Packages/Updates` wraps Sparkle 2.10.1 (pinned exactly). "Check for Updates…" is on only when `Info.plist` has `SUPublicEDKey` and `SUFeedURL`.
  - **Entitlement:** ad-hoc builds need `disable-library-validation` on `MacOS/Pica` to load `Sparkle.framework`. Developer ID builds don't get it.
  - **Optional:** Developer ID signing and notarization run only when their secrets exist, and skip cleanly otherwise.
  - **Draft `v0.1.0`** was built by workflow run 44947222511 from the H-06 branch, using a temporary push trigger that's now removed. It predates H-05, H-07 and C-11.
- **https://github.com/0zean/pica/pull/107 (H-07 Performance gate, built, unticked):** spec in `docs/performance.md`.
  - **Gate:** every §9 row has a test with a threshold, registered in `tools/perf/budgets.json`, and a vitest test checks that file against §9 row by row. `make perf` (`tools/perf/run.sh`) waits for the load to settle, runs each budget and reports measured values. The new `perf` workflow runs it on `macos-26`.
  - **New tests:** `EventDeliveryLatencyTests`, `ResourceBudgetUITests`, and budget recording in the existing perf tests. A-01's recovery check is a median of three kills; `PICA_PERF_GATE=1` makes A-09 assert the real 50 ms.
  - **No threshold changed.** Every budget passes on the reference Mac, an M2 Pro running the Debug build.
  - **Open (owner):** on GitHub's 3-core M1 VM, five budgets miss or are unstable: cold launch, keystroke to glyph, opening a 10,000-event session, scroll hitch and event delivery. They're in `PERF_NOT_GATING`: measured and reported, but they don't fail the job. The choices are keep that list, add a self-hosted Apple-silicon runner, or measure a Release build on GitHub. H-07 stays `todo` until the owner decides.
- **https://github.com/0zean/pica/pull/108 (C-11, done):**
  - **Engine:** the first `cost.delegation-limit` denial ends that `code-writer` delegation, and every later call in it is denied. The SDK can't end a sync sub-agent, so a worker that ignores the denial still spends worker-tier turns, but none of its calls run. `code-writer.md` is updated to match.
  - **D-21 amended (owner, "Rerun under (b2)"):** the reasoning-input limit is now `off`'s same-day spread: `off` runs 6 times and `balanced` 3, and the margin is the 95th percentile of a random 3-against-3 split. The credit and task limits are unchanged. See `docs/evals/2026-11-21-c11-gate-options.md`.
  - **Live result** (`docs/evals/2026-11-21-c11-b2-live.md`): `balanced` passed narrowly, at +6.1% reasoning input against a +6.46% margin. Credits were +23.4%, and all 15 tasks passed. It would still fail the old 5% gate. The run spent 60.93 of the 65-credit cap.
  - **D-22 confirmed (owner):** `off` stays the default.
- **https://github.com/0zean/pica/pull/109 (H-05 Reliability, done):** spec in `docs/reliability.md`.
  - **Corrupt database:** each store open runs `PRAGMA quick_check`. On `store.corrupt`, the engine moves `pica.db` and its sidecar files to `pica.db.corrupt-<UTC time>` and starts empty. `engine.health` gains an optional `storeRecovery {backupPath, reason, at}`, and the app shows a dismissible notice.
  - **Disk full:** `SQLITE_FULL` fails the session with the new error code `storage_full`. The log stays readable.
  - **Kill and resume:** 100 SIGKILL/resume cycles locally (about 40 s) and 25 on CI. `PICA_KILL_CYCLES` overrides the count.
  - **Crash backoff** (A-01's deferral): an exit within 60 s of ready counts as an early crash. Restarts come after 0, 1, 2, then 4 s. The 5th in a row shows `engine_crash_loop` with Try Again.
  - **Supervisor races fixed:** CI found that `EngineSupervisor` could hang the backoff test, and could silently drop a restart. Both are fixed.
- **Landing:**
  - **Order:** #110, then #107 (its session had already merged `main`), #108, #109. All four merged from this session with `--match-head-commit` after the owner said "Merge all the PRs".
  - **Checks:** each branch merged the latest `main`, passed `make verify` locally under the UI-test lock and passed CI at its head.
  - **#109's CI:** first run failed only on A-01's recovery timing, 2.21 s against 2 s. It passed on rerun.
  - **#108's CI:** ran no `verify-app` check, only `perf-gate` and `verify-engine`.

## Key files for next session
- `/Users/nick/Documents/repos/pica/PLAN.md`: the §12 index, D-21, D-22, and the C-11 and H-05 to H-07 notes.
- `/Users/nick/Documents/repos/pica/docs/distribution.md`, `/Users/nick/Documents/repos/pica/docs/performance.md`, `/Users/nick/Documents/repos/pica/docs/reliability.md` and `/Users/nick/Documents/repos/pica/docs/evals/2026-11-21-c11-gate-options.md`.
- `/Users/nick/Documents/repos/pica/tools/release/` and `/Users/nick/Documents/repos/pica/.github/workflows/release.yml`.
- Memory files touched: none.

## Running state
- Background processes, dev servers and ports: none.
- Side sessions, all idle with their PRs merged:
  - H-06: `local_9ff3cb36-cbf9-4923-821f-bc80d7f50c2d`.
  - H-05: `local_db6f1d26-6cf2-4253-8fe5-dba8d363e7fd`.
  - H-07: `local_f12c4f53-72e9-44a2-9994-4509487e8288`.
  - C-11: `local_62e5eab5-9da2-4e80-bcde-ecaf317f366a`.
  - The A-15, A-16, X-01 and X-02 sessions (see the previous handoff) are idle too.
- Worktrees: the folder names don't match the units.
  - `.claude/worktrees/a-05-session-timeline-1e04db` is on `dev/h-06-distribution-e32d9a`.
  - `.claude/worktrees/a-13-mcp-management-e71650` is on `dev/h-05-reliability-b42fcb`.
  - `.claude/worktrees/c-11-balanced-gate-dfbdc9` is on `dev/c-11-balanced-gate-dfbdc9`.
  - `.claude/worktrees/m-02-mcp-presets-9608d0` is on `dev/h-07-performance-gate-0de132`.
- GitHub:
  - Draft release `v0.1.0` exists, built before the last three merges.
  - The merged `dev/*` branches still exist on `origin`, including `dev/handoff-3` to `dev/handoff-8`.
- This update is on `dev/handoff-9`, cut from `main` at `f927dcb`.

## Verification — how to confirm things still work
- CI passed on #107 to #110 at their merged heads.
- `make verify` has not been run on `main` at `f927dcb` itself. It is #109's head, which included the other three, plus the merge commit.
- `make perf` runs the performance gate locally; without `PERF_NOT_GATING`, it gates on every budget.
- `make verify UNIT=H-06` runs the three distribution checks.
- **Running UI tests locally:**
  - The display must be awake and unlocked.
  - Run one UI test run at a time, under `lockf /tmp/pica-uitest.lock`.
- **Known flakes:**
  - A-01's engine-recovery timing on CI, as on #109.
  - A-09's quick-open benchmark under local load.

## Deferred + open questions
- **Owner steps:**
  - **Install for M4:** use draft `v0.1.0`, or rebuild the draft from current `main` first with `gh workflow run release.yml -f version=0.1.0`. Then install:
    ```bash
    gh release download v0.1.0 --repo 0zean/pica --dir ~/Downloads/pica-v0.1.0
    ```
    ```bash
    sh ~/Downloads/pica-v0.1.0/install.sh --from ~/Downloads/pica-v0.1.0
    ```
  - **Sparkle key:** create it and set the `SPARKLE_PRIVATE_ED_KEY` secret and the `SPARKLE_PUBLIC_ED_KEY` variable, as `docs/distribution.md` describes. Until then, builds don't update themselves, so reinstall once with `install.sh` after the first keyed release.
  - **Publishing:** only when ready, with `gh release edit vX.Y.Z --draft=false`.
  - **H-07:** decide on the five budgets that don't gate on GitHub's runner.
  - **M4:** complete it, which then unblocks H-08.
- **H-05:** usage-ledger and audit-log writes on a full disk aren't covered, nor is an engine left running when the app is killed.
- **C-11:** a worker that ignores the delegation-limit denial still spends worker-tier turns.
- **Still open from before:**
  - The X-01, A-16 and X-02 deferrals (see the previous handoff).
  - The A-10 to A-14 deferrals.
  - A-07's `permission.ask` and shell scope.
  - M-02's GHE endpoint and M-07's Codex import.
- **Open:**
  - The Auto-fix and merge permission rules for this repo. Side sessions don't merge; this session merges after the owner asks.
  - The product's `auto` tier choice and its price weighting.
  - Whether `smol-toml` may be added.
  - Whether to delete the merged `dev/*` branches and the stale worktrees.

## Pick up here
Every unit except H-07, which waits on the owner's runner decision, and H-08, which needs M4, is done. The owner installs Pica and completes M4: import a team, start a session, approve a tool call, review the diff, commit, open a PR, read the session's cost. Then H-08 (Documentation) is unblocked, and M5 needs a signed build on a second team member's Mac.
