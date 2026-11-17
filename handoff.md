# Session Handoff — C-10, A-01 and A-04 landed: Milestone M2 met with `off` as the default, and the app has its navigation shell

## Where it started
The owner asked to review `PLAN.md` and the previous handoff, then run C-10 (eval harness) and A-01 (app shell and engine supervision) in parallel side sessions. C-10's live run showed the 60% target couldn't be met. Getting there took three engine follow-ups, a revised target (D-21) and a new default profile (D-22). Both units landed, then A-04 (navigation shell) ran in a third side session and landed too. A-05 is now running.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/79 (C-07 follow-up):**
  - The routing profile's main-agent `excludedTools` and the delegation guide now reach the runtime.
  - `balanced` removes `create` and `apply_patch`; `strict` also removes `edit`; `off` removes nothing.
- **https://github.com/0zean/pica/pull/80 (C-04 follow-up):** under `balanced` and `strict`, a main-agent shell command that writes into the repo is denied, with a message naming `code-writer`.
  - Covered: redirects, heredocs, `tee`, `touch`, and the destination of `cp`, `mv` and `install`.
  - Still allowed: `node -e` and `python -c`, `sed -i`, and targets it can't resolve. These limits are listed under C-04.
  - The session's `onPreToolUse` read gate now applies this one rule to shell calls.
  - It also fixed the C-03 100% coverage check, which was already failing on `main`.
- **https://github.com/0zean/pica/pull/81 (C-01/C-05 follow-up):**
  - The `auto` rule now puts a model that supports reasoning effort on the reasoning tier, ahead of price. The worker tier takes the cheapest model.
  - The main session is now created with the reasoning tier's model. Before, Copilot's default (`claude-haiku-4.5`) ran the main agent whatever the tier said.
  - It landed through #77, which contained its head commit.
- **https://github.com/0zean/pica/pull/77 (C-10, done):**
  - 15 tasks over `fixtures/evals/`, including three "find the planted bug" comprehension tasks, each with a programmatic success check.
  - The runner takes a run count (3 by default for live runs); the report gives means and ranges.
  - FakeRuntime golden report. Docs in `docs/evals/README.md`.
  - Live report: `docs/evals/2026-11-16-c10-live.md` and `.json`. It ran on Copilot Pro, 90 sessions, with the reasoning tier pinned to `gpt-5.6-luna` and the worker tier on `auto` (`claude-haiku-5.5`). It cost 70.9 credits.
    - `balanced` against `off`: 15/15 tasks in both, +11.3% reasoning-tier input, +179% credits.
    - `code-writer` was 29.7 of the 52.2 credits `balanced` spent.
- **D-21 (`PLAN.md` §3):** the 60% target is replaced by a no-regression gate.
  - On the mean of 3 runs, `balanced` may use at most 5% more reasoning-tier input and at most 35% more credits, with at most one fewer task succeeding.
  - Why: Copilot's own `view` refuses whole reads of large files, and the main agent searches, reads ranges or writes scripts in every profile.
  - The eval-only model pin lives in the eval config, not in the product's `auto` rule.
- **D-22 (`PLAN.md` §3):** the default routing profile is `off`; `balanced` and `strict` are opt-ins.
  - Milestone M2, renamed "measured cost routing", was met on 2026-11-16 by the "gap explained and routing changed" branch.
  - §4.6 thresholds unchanged: no value would have made `balanced` cheaper.
- **New unit C-11, `todo`:** make `balanced` pass the D-21 gate, mainly by capping `code-writer`'s calls and output and tightening its prompt, then rerun the eval.
- **https://github.com/0zean/pica/pull/78 (A-01, done):** new package `app/Packages/AppShell`. Spec: `docs/app-shell.md`.
  - `EngineSupervisor` starts `picad`, either the bundled layout or `PICA_ENGINE_ENTRY`/`PICA_NODE`. It waits for the ready line and connects `EngineClient`. Failed starts back off at 250 ms, 500 ms, 1 s, then 2 s, and after 3 failures in a row it offers Try Again. It reuses an engine that is already listening.
  - A `picad` that exits before ready shows its exit code, its last log line and the `picad.log` path.
  - A protocol major mismatch shows a blocking panel naming both versions.
  - `SingleInstanceLock` is a `flock` on `app.lock`.
  - Measured: recovery after SIGKILL takes about 0.43 s (limit 2 s); the median cold launch is 0.43 s (budget 1.0 s, baseline in `LaunchBaseline.json`).
  - Makefile: `app-ui-test` is split into `app-ui-test-gallery` and `app-ui-test-pica`. `.github/workflows/app.yml` now installs Node and pnpm.
- **https://github.com/0zean/pica/pull/83 (A-04, done; marked in the index by https://github.com/0zean/pica/pull/84):** spec in `docs/navigation-shell.md`.
  - `NavigationStore` (`app/Packages/AppShell/.../Navigation`) is an `@Observable` store fed only by `EngineClient`.
    - On every connection it loads `workspace.list`, `repo.list` and `session.list`.
    - It applies `workspace.changed` and `session.changed` as they arrive. A notification wins over an older reload answer.
  - The window is a `NavigationSplitView`: a sidebar, a session column (a placeholder for A-05), and a toggleable `.inspector` placeholder.
  - Sidebar: a disclosure row per workspace, holding its repos and then its sessions. Sessions in `awaiting_approval` or `failed` sort first.
  - Keyboard:
    - The sidebar has focus at launch. Arrow keys select and open rows; Left/Right collapse and expand.
    - ⌘1–9 select sessions; ⌥⌘I toggles the inspector.
  - Restoration: the selection, the inspector's width and visibility, and collapsed workspaces are saved in `window-state.json` next to the socket. AppKit autosaves the sidebar width in `dev.pica.Pica` defaults.
  - UI tests run in a sandbox, so the socket lives in the runner's container. They create data through their own `EngineClient`, and `PicaUITests` now links `EngineClient`, `EngineClientTestSupport` and `PicaProtocol`.
  - Run a subset with `make app-ui-test-pica UI_TEST=<Class>[/<method>]`.
  - Cold launch median: 0.56 s (budget 1.0 s; the baseline is unchanged).
  - No protocol change and no new dependencies.
  - UI tests need macOS Automation Mode. The owner enabled it without authentication (`automationmodetool enable-automationmode-without-authentication`); `disable-automationmode-without-authentication` reverses it.
- **https://github.com/0zean/pica/pull/82:** `secret-leak-fuzz.test.ts` (M-03) now has a 60 s timeout and `seed: 3011`. It had timed out on CI at 5.45 s against the default 5 s limit.
- **Landing:** this session merged the PRs with `gh pr checks <n> --watch --fail-fast && gh pr merge <n> --merge --match-head-commit <sha>`, each time after the owner said to.
  - For #77 and #78, GitHub reported conflicts that a local `git merge origin/main` resolved cleanly. Merging `main` into the branch and pushing cleared it.
  - Auto-fix was turned on for #78 by its session, and nowhere else.

## Key files for next session
- `PLAN.md`: D-21 and D-22 in §3, the C-10 notes, C-11, M2, and the §12 unit index.
- `docs/navigation-shell.md` — A-04's design. A-05 fills its session column.
- `docs/evals/2026-11-16-c10-live.md` — the live numbers C-11 has to beat.
- `docs/evals/README.md` — the eval suite, sizing and how to run it.
- `docs/app-shell.md` — A-01's supervision design, which A-04 and H-05 build on.
- `app/Packages/AppShell/` — `EngineSupervisor`, `AppModel`, `RootView`, `SingleInstanceLock`.
- `engine/packages/server/tests/processes/fake-picad.ts` — the production composition over FakeRuntime, used by the app's tests.
- Memory files touched: none.

## Running state
- Side session **A-05: Session timeline** (`local_fa55331d-235c-4f28-b264-735702b74e5a`) is working in its own worktree. The A-04 session (`local_94845724-b76b-4ed9-859d-2b3edbcd9703`) started it, and its reports go there first.
- Background processes: none.
- Dev servers / ports: none. No `picad` is running.
- Worktrees and branches:
  - The side sessions' worktrees still exist. They hold branches that are now merged and behind `origin`, because this session pushed merges from `main` to them:
    - `.claude/worktrees/c-07-delegator-6533f3` on `dev/c-10-eval-harness-534aa3`
    - `.claude/worktrees/m-07-mcp-import-f88fb7` on `dev/a-01-app-shell-32ca5d`
    - `.claude/worktrees/m-02-mcp-presets-9608d0`, at a detached head
  - Merged branches still exist on `origin`:
    - `dev/c-10-eval-harness-534aa3`, `dev/a-01-app-shell-32ca5d`
    - `dev/c-07-main-agent-routing`, `dev/c-04-shell-write-gate`, `dev/c-01-auto-tiers`
    - `dev/m-03-fuzz-timeout`
    - the older `dev/*` branches listed in the previous handoff
    - Also merged: `dev/a-04-navigation-shell-d98293` and `dev/a-04-mark-done`.
- This handoff is on `dev/handoff-4`, cut from `main` at `ff6c73f`.
- Live eval runs wrote to the owner's real Pica data directory under `~/Library/Application Support/Pica/`.

## Verification — how to confirm things still work
- `make verify-engine` passes on `main` (1863 tests, 6 skipped). CI passed on #77, #78 and #82.
- `make verify UNIT=C-10` passes its deterministic checks. The live check is skipped unless `PICA_LIVE=1`.
- `make verify UNIT=A-01` covers recovery, the protocol mismatch and cold launch. The cold-launch test also runs as `make app-ui-test-pica`.
- `make verify UNIT=A-04` passes 3/3 (`NavigationShellUITests` and `NavigationStoreTests`). It needs Automation Mode.
- `make verify-app` passed on #78's CI, and the full `make verify` passed locally on #83.
- The live eval costs credits, about 70 on Copilot Pro for the full 3-run suite. Ask the owner first. The command is in `docs/evals/README.md`.

## Deferred + open questions
- **Deferred: C-11**, making `balanced` pass the gate. Recorded as `todo`, not started.
- **Deferred from A-01:**
  - No backoff for an engine that crashes repeatedly after connecting (H-05).
  - H-06 must bundle `Helpers/node` and `Resources/engine/picad.mjs`. Until then, a plain Xcode run needs `PICA_ENGINE_ENTRY` and `PICA_NODE` set in the scheme.
- **Deferred from A-04:**
  - The engine broadcasts nothing for `workspace.delete`, `repo.addPath` or `repo.remove`. The sidebar catches up on the next `workspace.changed` or reconnect.
  - When XCUITest kills Pica instead of quitting it, the engine it started is left running (H-05).
  - UI tests change the sidebar width in the developer's real `dev.pica.Pica` defaults.
  - The first launch after a rebuild can take more than 10 s while macOS checks the new binary. A-01's cold-launch test failed once on that, and passed on rerun.
- **Deferred from C-04:** the shell-write gate doesn't catch interpreter one-liners, `sed -i` or targets it can't resolve.
- **Deferred: E-11's "Not composed yet" list in `PLAN.md`:**
  - Per-session workspace and repo config layers.
  - The MCP registry, attachment and health monitor (M-01, M-04, M-06).
  - User hooks (X-03), OTLP export (H-04), and the R-08 tools.
  - Per-session worktrees (R-02).
  - PAT and device-flow auth, and hosts other than github.com (R-04, D-20).
- **Still deferred from before:**
  - C-07: the `child_session` delegator and per-agent `mcpServers`.
  - M-07: Codex import (needs TOML).
  - M-02: the GHE.com and GHES Copilot MCP endpoint is not recorded.
- **Open:**
  - On this account `auto` picks `kimi-k3` for the reasoning tier, at about 8 credits a session. Should the product's tier choice weigh price more?
  - May a TOML parser such as `smol-toml` be added for Codex import?
  - Should Auto-fix and the merge step be allowed in this repo's Claude permission settings?
  - Should the merged `dev/*` branches and the stale worktrees be deleted?

## Pick up here
Follow A-05 (session timeline) in its side session through to merge. A-06 and A-07 depend on it. C-11 is the open cost-router unit.
