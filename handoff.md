# Session Handoff — A-10, A-11, A-12 and A-13 landed

## Where it started
The owner asked to review `PLAN.md` and the previous handoff and start A-10, A-11, A-12 and A-13 in parallel sessions. Each unit ran in its own worktree session. All four PRs are merged into `main`, landed in order: #97, #98, #99, #100.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/99 (A-10 Terminal, done):** spec in `docs/terminal.md`, package `app/Packages/Terminal`.
  - **UI:** a `VSplitView` panel at the bottom of the session column, under the conversation or the review, toggled by the toolbar's Terminal button (⌃`).
  - **PTY:** lives in the app through SwiftTerm's `LocalProcessTerminalView`. Node has no PTY, and `node-pty` is off §8's list. The shell is the user's login shell, with no `PICA_*` variables.
  - **Roots:** new protocol method `session.roots`. The shell starts in the session's first root; with several roots, a header menu switches between them. Until R-10, a repo's root is its checkout.
  - **Closing:** sends SIGHUP, then SIGKILL after 2 s, and waits for SwiftTerm's exit monitor to reap the shell. SwiftTerm's `terminate()` isn't used.
  - **Dependency (owner's choice):** SwiftTerm pinned at 1.18.0. Since 1.12 it compiles a Metal shader, so building Pica needs Xcode's Metal Toolchain: `xcodebuild -downloadComponent MetalToolchain`, once per machine. CI's `verify-app` installs it when missing. The owner ran the download on this Mac, because auto mode blocked the session from running it.
- **https://github.com/0zean/pica/pull/97 (A-11 Usage and cost, done):** spec in `docs/usage.md`, package `app/Packages/Usage`.
  - **Engine:** no engine or protocol change. It uses `usage.rollup`, `workspace.list` and `config.get`.
  - **Chip:** a session chip over the timeline shows context, tokens and credits, toned at C-09's thresholds (0.75 and 0.9). Its popover shows credits by agent and model, and the savings estimate.
  - **Dashboard:** Window ▸ Usage Dashboard (⇧⌘U, `showUsage`). It covers 1, 7 or 30 UTC days, with an optional workspace filter, Swift Charts by day, model, agent and workspace, and budget warning rows.
  - **Estimate label:** the savings figure reaches views only through `SavingsFigure` ("Estimated savings"). Snapshot tests check the label with Vision text recognition.
  - **Fixtures:** the ledger fixture is the engine's own `usage.rollup` answers, checked by `server/tests/usage/app-fixtures.test.ts`. `fake-picad` has a `usage` scenario.
  - **Flaky test:** the PR also fixed a flaky A-09 quick-open test.
- **https://github.com/0zean/pica/pull/98 (A-12 Workspace and repo management, done):** spec in `docs/workspaces.md`, package `app/Packages/Workspaces`.
  - **UI:** selecting a workspace in the sidebar shows its management screen in the session column. `RootView` gains `workspaceContent` and `sidebarAccessory`.
  - **Actions:** new registry actions `newWorkspace` (⇧⌘N), `addRepository`, `importTeams` and `syncWorkspace`.
  - **Add Repository:** takes a path or a URL (partial clone), then pins it.
  - **Team browser:** search, multi-select and a preview of each team's repos. Import adds `team` sources and syncs once.
  - **Errors:** shown as `WorkspaceProblem`. `FixPerformer` turns the `fix` into a button; the app never runs `gh`.
  - **Engine:** the production composition serves `github.authStatus`, `github.listTeams` and `github.listTeamRepos` (`github-handlers.ts`).
  - **Protocol:** `host` is now optional on those three methods.
  - **Testing:** `fake-picad` starts a stub GitHub server under `PICA_TEST_GITHUB=signed-in|signed-out`.
- **https://github.com/0zean/pica/pull/100 (A-13 MCP management, done):** spec in `docs/mcp.md`, package `app/Packages/McpServers`.
  - **UI:** Window ▸ MCP Servers (⇧⌘M) has the catalog, add, edit, paste, import, authenticate, health and token-cost column. Attaching a server to a session is in the inspector's MCP pane.
  - **Engine:** the production composition serves every `mcp.*` method. Core `mcp-manage/` writes `mcp.jsonc` at global or workspace scope, and keeps attachments in `mcp-attachments.json`. A session's servers reach the runtime through the new `SessionOptions.mcpServers`.
  - **Protocol:** `workspaceId` on `mcp.add`, `mcp.update` and `mcp.remove`. `acknowledgeCacheReset` on `mcp.attach` and `mcp.detach`. New `mcp.attachments` and `ErrorCode.cache_reset_unconfirmed`.
  - **Live sessions:** a change to a live session is refused unless the change is acknowledged. Acknowledged, an idle session is closed and resumed (`SessionService.reconfigure`); a busy one answers `invalid_state`.
  - **Secrets:** go straight to the Keychain broker. `McpBackend` has no call that reads one.
  - **Testing:** UI tests use `PICA_SECRETS=memory`. `fake-picad` has an `mcp` scenario with a stub MCP server.
- **Landing:**
  - **#97:** merged from this session.
  - **#98–#100:** auto mode refused `gh pr merge` in the unit sessions. After the owner approved, this session merged #98, #99 and #100.
  - **How:** each PR merged `main` in, kept both sides of conflicts in the shared files, passed the full `make verify` locally and passed CI. Each then merged with `gh pr merge <n> --merge --match-head-commit <sha>`.
  - **CI flake:** #99's first CI failure was A-01's engine-recovery timing (2.08 s against 2 s) on the runner. It passed on rerun.

## Key files for next session
- `/Users/nick/Documents/repos/pica/PLAN.md`: the §12 index and the notes under A-10 to A-13.
- `/Users/nick/Documents/repos/pica/docs/terminal.md`, `/Users/nick/Documents/repos/pica/docs/usage.md`, `/Users/nick/Documents/repos/pica/docs/workspaces.md` and `/Users/nick/Documents/repos/pica/docs/mcp.md`.
- `/Users/nick/Documents/repos/pica/app/Pica/PicaApp.swift` and `/Users/nick/Documents/repos/pica/app/Pica/AppActions.swift`, where the app target wires in the four new packages and registry actions.
- Memory files touched: none.

## Running state
- Background processes, dev servers and ports: none.
- Side sessions, all idle with their PRs merged:
  - A-10: `local_e1d4a789-7722-4a14-90f3-4fb327528ec6`.
  - A-11: `local_0974191c-7ecf-44d1-a541-e14aee6ac5a7`.
  - A-12: `local_bb7f20b4-39d5-433d-96fd-799eb69d662f`.
  - A-13: `local_ce46335b-6893-4136-9428-34054b0cb370`.
- Worktrees: the folder names don't match the units.
  - `.claude/worktrees/a-05-session-timeline-1e04db` is on `dev/a-10-terminal-b3af1d`.
  - `.claude/worktrees/m-02-mcp-presets-9608d0` is on `dev/a-11-usage-cost-b7f753`.
  - `.claude/worktrees/c-07-delegator-6533f3` is on `dev/a-12-workspace-repos-e4df8c`.
  - `.claude/worktrees/a-13-mcp-management-e71650` is on `dev/a-13-mcp-management-e71650`.
- All merged `dev/*` branches still exist on `origin`, including `dev/handoff-3` to `dev/handoff-6`.
- This update is on `dev/handoff-7`, cut from `main` at `f2cbf57`.

## Verification — how to confirm things still work
- CI passed on #97–#100 at their merged heads.
- #100's head included A-10, A-11 and A-12, and the full `make verify` passed on it locally, including 31 Pica UI tests.
- `make verify` has not been run on `main` at `f2cbf57` itself.
- **Building the app:** needs the Metal Toolchain (`xcodebuild -downloadComponent MetalToolchain`).
- **Running UI tests locally:**
  - The display must be awake and unlocked.
  - Run one UI test run at a time, under one `lockf` lock.
- **Known timing flakes:**
  - A-09's quick-open benchmark, under load locally.
  - A-01's engine-recovery timing, on CI runners.

## Deferred + open questions
- **A-10:**
  - ⌃` isn't an `ActionID` in A-14's registry.
  - There is one shell per session.
  - The shell isn't confined to the session's roots.
- **A-11:** a workspace's `overrides.dailyCredits` is stored, but the engine doesn't enforce it. The dashboard warns against the config's daily cap only.
- **A-12:**
  - No workspace deletion.
  - A-04's `workspace.delete` broadcast and clone-state gaps remain.
- **A-13:**
  - Repo-scope servers aren't listed or attachable.
  - No file watching.
  - Login grants aren't persisted.
  - The app attaches servers to the whole session only; agent scope is engine-only.
  - `open_settings` fix targets don't open the window yet.
- **Still open from before:**
  - C-11's delegation-limit denial and reasoning-input margin.
  - A-07's `permission.ask` and shell scope in `onPreToolUse`.
  - A-08 to A-14 deferrals (see the previous handoff in git history).
  - M-02's GHE endpoint and M-07's Codex import.
  - H-05's crash backoff and H-06 bundling.
- **Open:**
  - The Auto-fix and merge permission rules for this repo. Auto mode still blocks agents from merging in side sessions.
  - The product's `auto` tier choice and its price weighting.
  - Whether `smol-toml` may be added.
  - Whether to delete the merged `dev/*` branches and the stale worktrees.

## Pick up here
A-10 to A-13 are done. A-15 (Onboarding) is now unblocked; A-12's notes in `PLAN.md` list what it can reuse. A-16, X-01 and X-02 are also ready, and C-11 is the open cost-router work.
