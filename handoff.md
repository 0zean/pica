# Session Handoff — M4 install fixes and gap fixes landed

## Where it started
After H-05, H-06, H-07 and C-11 landed, the owner installed draft `v0.1.0` to do M4. They hit three bugs: the MCP row's Sign In and Edit buttons wrapped one letter per line, there was no way to start a session, and Import Teams said Pica wasn't signed in to github.com although `gh` was. Each was fixed in its own worktree session and merged. Trying the rebuilt draft, the owner found four more gaps: no way to rename or delete a workspace, remove a repo, or rename or delete a session, and the composer's `@` list ran off the window. Those were fixed in three more worktree sessions (#116, #117, #118), merged, and the draft rebuilt again from `main` at `36a8925`.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/113 (engine PATH):** a Finder-launched app gets launchd's PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so the engine couldn't spawn `/opt/homebrew/bin/gh` and `github.authStatus` answered `signedIn: false`.
  - `AppShell/Engine/LoginShellPath.swift` resolves the login shell's PATH at launch, with a timeout and a fallback that prepends existing common directories, and `EngineProcess` merges it into the engine's environment.
  - `gh-cli-provider.ts` also tries well-known absolute paths for `gh`.
  - Documented in `docs/app-shell.md` and PLAN.md.
- **https://github.com/0zean/pica/pull/114 (New Session, ⌘N):** A-06's ⌘N was never built; no app code called `session.create`.
  - New `newSession` action (⌘N, File menu, palette), a "New Session…" button on the workspace screen and in the sidebar `+` menu.
  - `Workspaces/Views/NewSessionSheet.swift` + `Store/NewSessionStore.swift`: choose repos to write to and to reference, a first prompt, then Start. It calls `session.create` and selects the new session through `NavigationStore`. Errors show as `WorkspaceProblem`.
  - Documented in `docs/workspaces.md` and `docs/navigation-shell.md`; a UI test in `WorkspacesUITests`.
- **https://github.com/0zean/pica/pull/112 (MCP row buttons):** `ServerRow`'s action column was a fixed 120 pt, too narrow for Sign In + Edit + ⋯. The column is wider, the labels can't wrap, and the window's minimum width fits it. New `ServerRowLayoutTests` with macOS-26 and macOS-27 snapshots (the macOS-26 ones came from CI's artifact, as f33cf54 did).
- **Landing:** #113, #114, then #112, all with `--match-head-commit` after the owner said "Yes, merge and rebuild".
  - #114's and #112's CI each failed once on A-01's recovery timing (2.06 s and 2.0016 s against 2 s) and passed on rerun.
  - #114 was merged after #113 without a fresh CI run; they share only PLAN.md, which merged cleanly.
- **https://github.com/0zean/pica/pull/116 (`@` list placement):** the composer's `@` and `/` completion list opens upward, is capped to the session column's height, scrolls, and keeps the selected row visible. `CompletionListLayoutTests` and `LayoutProbe` cover it.
- **https://github.com/0zean/pica/pull/117 (workspace rename/delete, repo removal):** the app now calls the engine's existing `workspace.update`, `workspace.delete` and repo-removal methods, from the workspace screen and sidebar context menus, with confirmations. `workspace.delete` removes the workspace's sessions with their events and usage (a new `workspace.deleted` broadcast), and refuses while a session is running. Specified in `docs/workspaces.md`.
- **https://github.com/0zean/pica/pull/118 (session rename/delete):** new protocol methods for renaming and deleting a session and a `session.deleted` broadcast. **Store schema v4** adds `sessions.title` and `sessions.deleted_at`; a deleted session stays as an `ended` tombstone with its usage, so the daily cap and usage reports are unchanged. Rename and delete from the sidebar's context menu and the palette.
  - **A-01 on CI:** the engine-recovery check now allows three times its 2 s budget when `CI` is set, as the files and engine benchmarks already did; locally and in `make perf` it stays 2 s.
  - **Test guard:** a vitest setup file fails any engine test that resolves the real `~/Library/Application Support/Pica`.
- **Incident:** before that guard, `startup-benchmark.test.ts` started the engine with the real HOME during #118's `make test` and migrated the owner's real `pica.db` to v4, which the v0.1.0 build on `8ab1967` refuses (`store.schema_too_new`, no data moved). Its 3 sessions are intact; a copy is at `pica.db.backup-v4-20261122T073054Z` (with `-wal` and `-shm`). The owner chose to keep v4 and install the rebuilt draft, which reads it.
- **Second landing:** #116 and #117 merged at green CI; #118's session merged `main` into it (conflicts in `NavigationStore.swift` and the session test helpers, both sides kept), its CI passed at `1d31011`, and it merged. All after the owner said "Yes, merge and rebuild".
- **Draft `v0.1.0`:** rebuilt again from `main` at `36a8925` by run 45012844813; its engine bundle includes `session.rename`, so it reads the v4 database. (The first rebuild, from `8ab1967`, was run 44992625008.) The downloaded zip and `install.sh` pass `shasum -c SHA256SUMS` and `codesign --verify --deep --strict`; the bundle version is 0.1.0.
  - **Its target commit is still `5a5ca55`,** the old H-06 branch commit. The workflow replaces the files but not that. Before publishing: `gh release edit v0.1.0 --repo 0zean/pica --target main`.

## Key files for next session
- `/Users/nick/Documents/repos/pica/PLAN.md`: the §12 index and unit notes.
- `/Users/nick/Documents/repos/pica/app/Packages/Composer/Sources/Composer/Views/SessionComposer.swift` and `CompletionList.swift` (the `@` list).
- `/Users/nick/Documents/repos/pica/app/Packages/AppShell/Sources/AppShell/Navigation/NavigationStore.swift` (session and workspace deletion).
- `/Users/nick/Documents/repos/pica/app/Packages/Workspaces/` (workspace screen, sheets, `WorkspaceManager`).
- `/Users/nick/Documents/repos/pica/engine/packages/protocol/src/methods.ts` (what the engine serves).
- `/Users/nick/Documents/repos/pica/docs/distribution.md` and `/Users/nick/Documents/repos/pica/.github/workflows/release.yml`.
- Memory files touched: none.

## Running state
- Background processes, dev servers and ports: none.
- Side sessions, all idle with their PRs merged:
  - MCP row buttons: `local_701fbd4b-0a08-4d2e-882e-0311209e0c1c`.
  - New Session: `local_cd8ec5d8-a327-4975-a402-eaae39207963`.
  - Engine PATH: `local_cf66705c-8d3e-4165-a34b-a4c6aee154cf`.
  - Workspace rename/delete: `local_10e08245-236a-41d0-8410-678b27fba206`.
  - Session rename/delete: `local_554a5167-94ce-4bf2-8ef3-bc8d5f49d128`.
  - `@` list: `local_46393bee-a7c4-410f-9b06-a2ac0f44c915`.
  - The H-05, H-06, H-07, C-11, A-15, A-16, X-01 and X-02 sessions (see earlier handoffs) are idle too.
- Worktrees: the six new ones are on `dev/mcp-row-buttons-ecd092`, `dev/new-session-command-4ff5b8`, `dev/engine-login-path-8611b0`, `dev/workspace-rename-delete-119daf`, `dev/session-rename-delete-a8a3ec` and `dev/mention-list-placement-698b9c`; earlier ones are listed in the previous handoff.
- GitHub: draft release `v0.1.0` (see above). Merged `dev/*` branches still exist on `origin`.
- This update is on `dev/handoff-10`, with `main` at `36a8925` merged in.

## Verification — how to confirm things still work
- CI passed on #112 to #114 and #116 to #118 at their merged heads. `make verify` has not been run on `main` at `36a8925` itself.
- **Reinstall the draft:**
  ```bash
  gh release download v0.1.0 --repo 0zean/pica --dir ~/Downloads/pica-v0.1.0-b
  ```
  ```bash
  sh ~/Downloads/pica-v0.1.0-b/install.sh --from ~/Downloads/pica-v0.1.0-b
  ```
  Quit Pica before installing; the old engine can't restart on the v4 database, the new one can.
- **Running UI tests locally:**
  - The display must be awake and unlocked.
  - Run one UI test run at a time, under `lockf /tmp/pica-uitest.lock`. Three sessions running full `make verify` at once caused lost clicks and keystrokes in unrelated suites; every one passed rerun alone.
- **Known flakes:** A-01's engine-recovery timing on CI (hit four times before #118 loosened it on CI), `corrupt-database.test.ts`'s 5 s timeout on CI (#117), A-09's quick-open benchmark under local load, and a SessionOverview timing test on CI (#112).

## Deferred + open questions
- **M4 gaps:** the four found so far are fixed (#116 to #118).
  - The owner's screenshot also showed "The engine stopped; the session can be resumed". The owner thinks it came from quitting Pica after a session and reopening it, which is the expected state; check `engine.log` only if it shows up without a quit.
- **Owner steps:**
  - Reinstall and continue M4: import a team, start a session, approve a tool call, review the diff, commit, open a PR, read the session's cost. Then H-08 is unblocked.
  - **Sparkle key:** create it and set the `SPARKLE_PRIVATE_ED_KEY` secret and `SPARKLE_PUBLIC_ED_KEY` variable (`docs/distribution.md`).
  - **Publishing:** retarget to `main` first, then `gh release edit v0.1.0 --draft=false`.
  - **H-07:** decide on the five budgets that don't gate on GitHub's runner.
- **Still open from before:** H-05's full-disk ledger and audit writes and the orphaned engine; C-11's worker that ignores the denial; the X-01, A-16, X-02 and A-10 to A-14 deferrals; A-07's `permission.ask` and shell scope; M-02's GHE endpoint and M-07's Codex import; the `auto` tier and its price weighting; whether `smol-toml` may be added; whether to delete merged `dev/*` branches and stale worktrees.
- **Process:** parallel sessions' full `make verify` runs contend for the screen and the CPU; prefer running UI tests one session at a time. Side sessions can't be woken by CI unless the PR monitor is turned on in them; the MCP row session declined to poll `gh` after its monitor was denied, so this session relayed CI results.

## Pick up here
The owner quits Pica, installs the rebuilt draft (from `36a8925`, which reads the v4 database) and continues M4: import a team, start a session, approve a tool call, review the diff, commit, open a PR, read the session's cost. Then H-08 (Documentation) is unblocked. H-07 still waits on the owner's runner decision.
