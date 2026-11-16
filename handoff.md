# Session Handoff — E-11 landed: picad has a production composition, and Milestone M1 passes live

## Where it started
The previous handoff named the biggest gap: `picad` had no production composition, so a real engine answered `session.*` as not implemented, and Milestone M1 had never run end to end. This session added unit E-11 for that composition, built it, ran M1 live, and landed it.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/74, E-11, merged as `20f039b`.**
  - `composeEngine` in `engine/packages/server/src/composition.ts` runs from `main.ts` before the socket opens. Its helpers are `composition-config.ts` and `composition-workspaces.ts`.
  - Everything lives under `~/Library/Application Support/Pica/`: `pica.db`, `audit/audit.jsonl`, `sessions/<id>/artifacts/`, and `repos/` for managed clones.
  - It composes:
    - `CopilotRuntime`, which connects lazily, so startup needs no login.
    - The user `config.jsonc` with the managed policy (H-01). Each call re-reads it; an edit that doesn't validate is logged and the last good config is kept.
    - The model catalog with fallback prices (C-01).
    - The read gate (C-04) and output guard (C-06).
    - The runtime-native delegator over the built-in and user agents (C-07), the usage ledger (C-08), budgets (C-09) and the audit log (H-02).
    - Workspaces (R-06), with discovery through `gh auth token` on github.com.
    - The repo registry (R-03).
    - The MCP import (M-07).
  - New engine option `EngineSessionOptions.readGate`: read-gate decisions go to the audited session log, the same way the output guard's do.
  - New handlers (`repo-handlers.ts`): `repo.addPath`, `repo.addUrl` and `repo.remove`. Before this, nothing answered them.
  - If the store, config, agent files or audit log can't be opened, `picad` exits with code 1 before its ready line, naming the file and key path.
  - CLI: new `pica workspace create|list` and `pica repo add <path> [--workspace <id>]|list`. `repo add .` resolves against the directory the CLI runs in.
  - `@pica/adapters` moved to `dependencies` of `@pica/server`, because `picad` loads it at runtime.
  - `engine-lifecycle.test.ts` used to start the real `picad` with the developer's real `HOME`. It now uses the test directory and checks for a real answer.
- **Milestone M1 met, 2026-11-15, Copilot Free.**
  - Two main-agent calls routed to `mai-code-1.1-flash`: 10,541 input, 12,800 cached and 139 output tokens, 0.2531 credits.
  - The README `view` needed no permission prompt.
  - Recorded under E-11's live check and the M1 line in `PLAN.md`.
- **https://github.com/0zean/pica/pull/75, merged as `3230be7`:** E-11 is `done` in the unit index.
- **Landing on this repo:**
  - GitHub auto-merge is not allowed. `mcp__ccd_pr__set_auto_merge` fails with "Auto merge is not allowed for this repository".
  - Land with `gh pr checks <n> --watch --fail-fast && gh pr merge <n> --merge --match-head-commit <sha>`, run in the background.
  - The auto-mode permission check blocked turning Auto-fix on (`mcp__ccd_pr__set_monitor`). It also blocked merging a PR the owner hadn't explicitly said to merge. Ask the owner first, each time.

## Key files for next session
- `engine/packages/server/src/composition.ts`, `composition-config.ts` and `composition-workspaces.ts` — what `picad` composes, and where each follow-up plugs in.
- `engine/packages/server/src/engine.ts` (`EngineOptions`, `EngineSessionOptions`) — the options the composition fills.
- `PLAN.md` — E-11's "Not composed yet" list, C-10, A-01, and §12 for what is still `todo`.
- Tests:
  - `engine/packages/server/tests/composition/production.test.ts`: the composition over the socket with a FakeRuntime, plus the bad-config startup case.
  - `engine/packages/cli/tests/workspace-repo.test.ts`
  - `engine/packages/cli/tests/live-m1.test.ts`
- Memory files touched: none.

## Running state
- Background processes: none. No `picad` is running.
- Dev servers / ports: none.
- Branches: `main` at `3230be7`, locally and on origin. These merged branches still exist locally and on origin:
  - `dev/e-11-picad-composition`
  - `dev/e-11-done`
  - `dev/c-07-delegator-6533f3`
  - `dev/m-02-mcp-presets-9608d0`
  - `dev/m-07-mcp-import-f88fb7`
- The worktrees for the three earlier side sessions still exist under `.claude/worktrees/`, at detached heads. Archiving those sessions removes them.
- The live M1 run left an "M1 check" workspace and this checkout as a repo in the owner's real Pica data directory. Later runs reuse them. Its session shows `resumable` because the test stops `picad` afterwards.

## Verification — how to confirm things still work
- `make verify-engine` passed on the E-11 branch: 1764 tests. CI's `verify-engine` passed on #74 and #75.
- `make verify UNIT=E-11` passes its four deterministic checks.
- The live check: `PICA_LIVE=1 pnpm -C engine exec vitest run packages/cli/tests/live-m1.test.ts`. It needs a Copilot CLI login, spends a little of the quota, and writes to the real Pica data directory.
- By hand, with a short socket path:
  - Start: `PICA_ENGINE_ENTRY=engine/packages/server/src/main.ts node --experimental-strip-types engine/packages/cli/src/main.ts --socket /tmp/x/s session list`
  - Stop the engine afterwards with `pkill -f /tmp/x/s`.
- `make verify-app` was not run. No protocol or app files changed.

## Deferred + open questions
- **Deferred: E-11's "Not composed yet" list in `PLAN.md`.**
  - Per-session workspace and repo config layers. The read gate, output guard and budgets use only the user layer and the managed policy, and budgets are read once at start.
  - The MCP registry, attachment and health monitor (M-01, M-04, M-06).
  - User hooks (X-03), OTLP export (H-04), and the R-08 repo tools.
  - Per-session worktrees (R-02). Sessions run in the registered checkout, so `session.writeRoots` (worktrees) is empty.
  - PAT and device-flow GitHub auth, and hosts other than github.com (R-04, D-20).
- **Still deferred from before:**
  - C-07: the `child_session` delegator and per-agent `mcpServers`. (The profile's main-agent `excludedTools` and the delegation guide are now passed to the runtime.)
  - M-07: Codex (needs TOML).
  - M-02: the GHE.com and GHES Copilot MCP endpoint is not recorded.
- **Open:**
  - May a TOML parser such as `smol-toml` be added for Codex import?
  - Should Auto-fix and the merge step be allowed in this repo's Claude permission settings, so landing doesn't stop for approval?
  - Should the merged `dev/*` branches be deleted?

## Pick up here
With a real engine behind the socket, the two units waiting on one can start:
- **C-10, eval harness.** Its live check needs the composed engine and a plan that lists models for a meaningful reasoning-vs-worker comparison.
- **A-01, app shell and engine supervision.** It supervises the real `picad`.

Some composition follow-ups gate other milestones:
- MCP attachment and health, for A-13.
- Per-session worktrees, for A-08 and A-10.

Pick those up as their units need them.
