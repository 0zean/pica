# Session Handoff — M-02, C-07 and M-07 landed; the import is wired into picad

## Where it started
Phase 0 and G0 closed on 2026-11-15 (#66 to #68). The owner then asked for M-07 and M-02 to run in parallel sessions, and C-07 in a third, followed by all three landed one at a time. Wiring M-07's import service into `picad` came last.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/69, M-02 presets, merged as `c8774ee`.**
  - What it adds: `engine/packages/core/src/mcp-presets/`, presets for GitHub, Datadog, ClickUp and Snowflake. They use only the §2.2 endpoints and only secret references, and none is enabled by default.
  - RPCs: `mcp.presets` and `mcp.renderPreset`, which add or attach nothing.
  - The GitHub preset follows the configured host. GHE.com and GHES require an explicit `url`, because their Copilot MCP endpoint is not recorded.
  - Spec: `docs/mcp-presets.md`.
- **https://github.com/0zean/pica/pull/70, C-07 Delegator, merged as `0dd41a5`.**
  - What it adds: the `Delegator` port in `engine/packages/core/src/delegation/`, and a runtime-native implementation that builds `customAgents` from C-02 definitions and C-05 profiles. Each child gets exactly its definition's tools, and `model` is omitted when its tier resolves to `null`.
  - Wiring: through `createSessionService({ delegator })` and `EngineSessionOptions.delegator`.
  - Live run on Copilot Free: no worker model was requested, and bulk-reader's calls routed to `gpt-6-luna`. The check records that and passes.
  - The `child_session` fallback mode is declared but not built; it is a follow-up in `PLAN.md` C-07.
- **https://github.com/0zean/pica/pull/71, M-07 import, merged as `d8d7e58`.**
  - What it adds:
    - Pure formats in `engine/packages/core/src/mcp-import/` for Claude Desktop, Claude Code, Cursor, Windsurf, VS Code user settings and Gemini CLI, plus a paste parser.
    - macOS discovery in `engine/packages/adapters/src/config/mcp-import-paths.ts`.
    - The `mcp.importCandidates` and `mcp.import` RPCs, and the engine→client `secrets.set` request, which Swift's `SecretBroker.store` answers.
  - Codex is deferred: it needs a TOML parser, and adding `smol-toml` was not approved in that session. Spec: `docs/mcp-import.md`.
  - It conflicted with #69 in `methods.ts` and `engine.ts`, because both added methods and handlers. The resolution keeps both sides, with the protocol schema and Swift regenerated.
- **https://github.com/0zean/pica/pull/72, wiring, merged as `c33b9aa`.**
  - `engine/packages/server/src/main.ts` composes `mcpImportOptions(homedir())`, defined in `engine/packages/server/src/composition.ts`.
  - That made `picad` load `@pica/adapters` for the first time, and it crashed at startup. The CLI runs `picad` with `node --experimental-strip-types`, which cannot run TypeScript parameter properties.
  - Five classes were fixed, including `CopilotRuntimeSession`. `engine/tsconfig.json` now sets `erasableSyntaxOnly`.
  - `engine/packages/server/tests/main-startup.test.ts` starts `picad` the way the CLI does, and fails if the fix is reverted.
- **Landing:** `verify-engine` is required on `main`, and GitHub auto-merge is off. The procedure is to merge `origin/main` into the branch, run `make verify-engine` and `make verify UNIT=<ID>` (plus `make verify-app` if protocol files changed), push, then run `gh pr checks <n> --watch --fail-fast && gh pr merge <n> --merge --match-head-commit <sha>`.
- **Pitfall:** a Unix socket path over 104 bytes fails with a misleading `EADDRINUSE` on macOS. Use a short directory under `$TMPDIR` for hand-run sockets.

## Key files for next session
- `PLAN.md` — §10 C-07 (follow-ups), M-02, M-07 (Codex deferred), and §12 for what is still `todo`.
- `engine/packages/server/src/main.ts` and `engine/packages/server/src/engine.ts` (`EngineOptions`) — what `picad` composes today, and what it could.
- `docs/mcp-presets.md`, `docs/mcp-import.md`.
- Memory files touched: none.

## Running state
- Background processes: none.
- Dev servers / ports: none.
- Branches: only `main`, at `c33b9aa`, locally and on origin.
- Side-session worktrees still exist for the three idle sessions:
  - `.claude/worktrees/m-02-mcp-presets-9608d0`
  - `.claude/worktrees/c-07-delegator-6533f3`
  - `.claude/worktrees/m-07-mcp-import-f88fb7`

  Their branches are merged. Archiving those sessions removes them.

## Verification — how to confirm things still work
- `make verify` (from the repository root) — passed on `main` at `d8d7e58`, the engine (1756 tests), Swift packages, app build and UI tests included. `make verify-engine` passed again after #72 (1759 tests).
- `make verify UNIT=M-02`, `UNIT=C-07` and `UNIT=M-07` pass. C-07's live check needs `PICA_LIVE=1` and a Copilot CLI login.
- `pnpm -C engine exec vitest run packages/server/tests/main-startup.test.ts` — `picad` starts under type stripping.

## Deferred + open questions
- **Deferred, the largest gap: `picad` has no production composition.**
  - `main.ts` passes only the socket, log and MCP import. It opens no SQLite store and creates no `CopilotRuntime`, session service, delegator, workspaces, model catalog pricing, MCP health monitor or presets host.
  - So the CLI's `pica session new` gets no `session.*` handlers from a real `picad`, and Milestone M1 (live: `pica session new --repo . "summarize the README"`, then `pica usage`) has never been run end to end.
  - No unit in §12 owns this composition.
- **Deferred:**
  - C-07 follow-ups: the `child_session` delegator; merging M-04's per-agent `mcpServers` into `customAgents`; passing the profile's `excludedTools` and delegation guide to the runtime.
  - M-07: Codex (TOML). Workspace- and repo-scope imports need `picad` to compose workspaces.
  - M-02: the GitHub preset's Copilot MCP endpoint for GHE.com and GHES is not recorded.
  - Nothing reads `engine.account` yet.
- **Open:**
  - May a TOML parser such as `smol-toml` be added for Codex import?
  - Should the `picad` composition become its own unit (for example E-11), ahead of C-10 and A-01?

## Pick up here
Add a unit for `picad`'s production composition and build it, then run Milestone M1 live. C-10 (eval harness) and A-01 (app shell) both need a real engine behind the socket.
