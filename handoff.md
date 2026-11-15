# Session Handoff — Phase 0 closed; owner answers recorded; S-01 data in use

## Where it started
The previous handoff listed 12 next steps. On 2026-11-15 the owner:
- confirmed S-05 on a second macOS device;
- reported that Datadog, ClickUp (browser OAuth) and Snowflake (PAT) work on the org's Macs through another client;
- decided that every MCP server is optional, and that users should be able to add any server they already use in other agent platforms;
- answered Q-02 (support all three GitHub deployments), Q-05 (no registered GitHub App or OAuth App may be assumed) and Q-07 (Pica is for any individual, team, company or org);
- asked for `verify-engine` to be required on `main`, accepted `dev.pica.Pica`, and asked for steps 7 to 12 to be done.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/66, merged as `198cf31`:**
  - S-05 is done.
  - S-06 is done, and A8 is confirmed. Pica connected GitHub itself (rerun live: 46 tools, 13,835 tokens). The other three servers are optional, so the live checks cover GitHub only.
  - **G0 is met**: A1 to A9 are resolved, A4 through its recorded fallback (D-08).
  - **D-18**: every MCP server is optional; the four servers are presets (M-02); any other server can be added by hand, by paste, or by import. The import is the new unit **M-07**, and A-13 now depends on it.
  - **D-19**: Pica assumes no organization and no registered app.
  - **D-20**: github.com, GHE.com and GHES are all supported. A `*.ghe.com` host now defaults to `https://api.<subdomain>.ghe.com`; the code is in `engine/packages/core/src/github/hosts.ts`.
  - `make lint-swift-boundary` (`tools/lint/swift-boundary.sh`) is part of `verify-engine`. It fails when a Swift source names the git executable or a GitHub host. A line can opt out with a `swift-boundary: allow` comment.
  - The verify-runner tests clean up their temp folders.
  - §4.2 now matches the app layout.
- **https://github.com/0zean/pica/pull/67, merged as `3e5f475`:**
  - New RPC `engine.account`, handled in `engine/packages/server/src/account-handlers.ts`, with its DTO in `engine/packages/protocol/src/dto/account.ts`.
  - `session.usage_checkpoint` and `session.shutdown` set a floor under the session budget, in `engine/packages/core/src/sessions/service.ts` (`catchUpSpend`).
  - FakeRuntime scenarios gain a `usageCheckpoint` step.
  - A live test of the gh-token fallback (empty `COPILOT_HOME`) confirmed `runtime.no_models` on Copilot Free.
- **`verify-engine` is a required status check on `main`.** Set through classic branch protection: admins can bypass, and no review is required. GitHub auto-merge is disabled for the repository, so "merge once CI passes" runs as `gh pr checks <n> --watch --fail-fast && gh pr merge <n> --merge --match-head-commit <sha>`.
- **Cleanup:**
  - Removed the 3 remaining merged worktrees under `.claude/worktrees/`.
  - Deleted 63 merged local `dev/*` branches and 63 merged remote ones.
  - Deleted the local S-05 test folder (498 MB).
  - The earlier Pica side sessions were already archived.
- **Pitfalls:**
  - In zsh, an unquoted `$VAR` holding a list is not split into words. Use `bash -c` or arrays for loops over refs.
  - A global `sed` of `account.get` also rewrote the SDK's `account.getQuota` and `account.getAllUsers`. That was caught and restored before the commit.

## Key files for next session
- `PLAN.md` — §2.2 (optional MCP), §3 D-18 to D-20, M-02 and M-07 in §10, and §12.
- `engine/packages/core/src/mcp/import/` and `engine/packages/adapters/src/config/mcp-paths.ts` — M-01's import formats, which M-07 extends.
- `docs/spikes/S-01.md` and `S-06.md` — the resolution notes.
- Memory files touched: none.

## Running state
- Background processes: none.
- Dev servers / ports: none.
- Branches: only `main`, locally and on origin; every merged branch is deleted. No worktrees.

## Verification — how to confirm things still work
- `make verify`, from the repository root — passes on `dev/account-and-checkpoint`: engine (1656 tests), Swift packages, app build, and UI tests (`** TEST SUCCEEDED **`).
- `PICA_LIVE=1 make verify UNIT=S-06` — the GitHub connect and token checks pass.
- `PICA_LIVE=1 pnpm -C engine exec vitest run packages/adapters/tests/copilot/live-smoke.test.ts -t "gh CLI fallback"` — passes.

## Deferred + open questions
- Deferred: **M-07** (import from other agent platforms) is planned but not built. It needs `mcp.importCandidates` and `mcp.import`. Codex keeps its config in TOML, which needs a parser.
- Deferred: **M-02** presets, which are now unblocked. The GitHub preset's endpoint on GHE.com and GHES is not recorded yet.
- Deferred: no client reads `engine.account` yet. The app (A-01 onwards) or a `pica account` CLI command could.
- Open: should `handoff.md` be committed? It stays untracked for now: the repository is public, and this file holds local paths and session details.

## Pick up here
Phase 2 can start now that G0 is met (C-07 Delegator, then C-10 and M2). A-01 is unblocked by S-05, and M-02 and M-07 can run in parallel.
