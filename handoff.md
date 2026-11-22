# Session Handoff — M4 install fixes landed, new gaps from M4

## Where it started
After H-05, H-06, H-07 and C-11 landed, the owner installed draft `v0.1.0` to do M4. They hit three bugs: the MCP row's Sign In and Edit buttons wrapped one letter per line, there was no way to start a session, and Import Teams said Pica wasn't signed in to github.com although `gh` was. Each was fixed in its own worktree session and merged. The draft was rebuilt from `main` at `8ab1967`. Trying it, the owner found more gaps (see "Pick up here").

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
- **Draft `v0.1.0`:** rebuilt from `main` at `8ab1967` by run 44992625008. The downloaded zip and `install.sh` pass `shasum -c SHA256SUMS` and `codesign --verify --deep --strict`; the bundle version is 0.1.0.
  - **Its target commit is still `5a5ca55`,** the old H-06 branch commit. The workflow replaces the files but not that. Before publishing: `gh release edit v0.1.0 --repo 0zean/pica --target main`.

## Key files for next session
- `/Users/nick/Documents/repos/pica/PLAN.md`: the §12 index and unit notes.
- `/Users/nick/Documents/repos/pica/app/Packages/Composer/Sources/Composer/Views/SessionComposer.swift` (the `@` completion overlay, line ~44) and `CompletionList.swift`.
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
  - The H-05, H-06, H-07, C-11, A-15, A-16, X-01 and X-02 sessions (see earlier handoffs) are idle too.
- Worktrees: the three new ones are on `dev/mcp-row-buttons-ecd092`, `dev/new-session-command-4ff5b8` and `dev/engine-login-path-8611b0`; earlier ones are listed in the previous handoff.
- GitHub: draft release `v0.1.0` (see above). Merged `dev/*` branches still exist on `origin`.
- This update is on `dev/handoff-10`, cut from `main` at `8ab1967`.

## Verification — how to confirm things still work
- CI passed on #112, #113 and #114 at their merged heads. `make verify` has not been run on `main` at `8ab1967` itself.
- **Reinstall the draft:**
  ```bash
  gh release download v0.1.0 --repo 0zean/pica --dir ~/Downloads/pica-v0.1.0-b
  ```
  ```bash
  sh ~/Downloads/pica-v0.1.0-b/install.sh --from ~/Downloads/pica-v0.1.0-b
  ```
  Quit and reopen Pica so the engine restarts with the login shell's PATH.
- **Running UI tests locally:**
  - The display must be awake and unlocked.
  - Run one UI test run at a time, under `lockf /tmp/pica-uitest.lock`. Three sessions running full `make verify` at once caused lost clicks and keystrokes in unrelated suites; every one passed rerun alone.
- **Known flakes:** A-01's engine-recovery timing on CI (hit three times this round), A-09's quick-open benchmark under local load, and a SessionOverview timing test on CI (#112).

## Deferred + open questions
- **New gaps found in M4 (not started):**
  - **Workspaces:** no way to rename or delete a workspace. The engine serves `workspace.update` (takes `name`) and `workspace.delete`; the app calls neither. A-04's `workspace.delete` and clone-state gaps were already noted.
  - **Repos:** no way to remove a repo from a workspace. The engine serves `workspace.unpinRepo`, `workspace.removeSource` and `repo.remove`; the app calls none.
  - **Sessions:** no way to rename or delete a session. The protocol has `session.end` but no rename or delete method, so this needs protocol, engine and app work.
  - **`@` mention list:** in the composer, the list of repos, files and agents opens downward from the input and runs past the bottom of the window, so most choices are hidden. `SessionComposer.swift` overlays `CompletionList` at `.topLeading` with an `alignmentGuide` meant to put it above the input; it should open upward (or flip to fit) and scroll within the space available.
  - The owner's screenshot also showed "The engine stopped; the session can be resumed" on a session. Not yet looked into; check `engine.log` if it recurs.
- **Owner steps:**
  - Reinstall and continue M4: import a team, start a session, approve a tool call, review the diff, commit, open a PR, read the session's cost. Then H-08 is unblocked.
  - **Sparkle key:** create it and set the `SPARKLE_PRIVATE_ED_KEY` secret and `SPARKLE_PUBLIC_ED_KEY` variable (`docs/distribution.md`).
  - **Publishing:** retarget to `main` first, then `gh release edit v0.1.0 --draft=false`.
  - **H-07:** decide on the five budgets that don't gate on GitHub's runner.
- **Still open from before:** H-05's full-disk ledger and audit writes and the orphaned engine; C-11's worker that ignores the denial; the X-01, A-16, X-02 and A-10 to A-14 deferrals; A-07's `permission.ask` and shell scope; M-02's GHE endpoint and M-07's Codex import; the `auto` tier and its price weighting; whether `smol-toml` may be added; whether to delete merged `dev/*` branches and stale worktrees.
- **Process:** side sessions can't be woken by CI unless the PR monitor is turned on in them; the MCP row session declined to poll `gh` after its monitor was denied, so this session relayed CI results.

## Pick up here
The owner reinstalls the rebuilt draft and continues M4. In parallel, the new gaps above are ready to start as units: workspace rename and delete plus repo removal (app only, engine methods exist), session rename and delete (protocol, engine and app), and the `@` mention list placement in the composer.
