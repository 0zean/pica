# Session Handoff — A-08, A-09 and A-14 landed, and UI tests no longer need a Documents grant

## Where it started
The owner asked to review `PLAN.md` and the previous handoff and start the next units. They also asked to allow Auto-fix and merging in this repo, and to make the UI tests stop depending on the Documents grant. This session ran four side sessions: the Documents-grant fix, A-08, A-09 and A-14. All four PRs are merged into `main`.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/92 (Q-08 answered: UI tests need no Documents grant):**
  - **Cause:** the TCC log showed two readers of `~/Documents` during UI tests. One is the `node` process running `picad`, attributed to Pica. The other is the UI-test runner, which reads the `Pica.app` it launches from `app/.derived` and A-01's `LaunchBaseline.json`. Ad-hoc signing made both ask again after every rebuild.
  - **Fix:** `make app-ui-test-pica` and `make app-ui-test-gallery` build into `~/Library/Caches/dev.pica.ui-tests/<checkout hash>/derived` and run `lsregister -f` on that build. They pass staged copies of `engine/` and the baseline (`tools/ui-tests/stage-engine.sh`) through `TEST_RUNNER_PICA_UI_TEST_ENGINE` and `TEST_RUNNER_PICA_LAUNCH_BASELINE`.
  - **Needs:** no signing identity or Developer ID, wherever the checkout is.
  - **Still asks:** running PicaUITests from Xcode, with derived data and the engine under `~/Documents`.
  - **Verified:** after resetting the grant, A-06, A-07, the Gallery tests and all 12 PicaUITests passed with no prompt.
- **https://github.com/0zean/pica/pull/94 (A-08 Review, done):** spec in `docs/review.md`, package `app/Packages/Review`.
  - **UI:** the review replaces the conversation in the session column. It is switched by the toolbar's Review Changes (⇧⌘R), not shown in the inspector.
  - **Engine:** the production composition serves `git.*` (`git-handlers.ts`). It checks each call against the session's roots, and only write roots can be changed. Until R-10, a session's worktree of a repo is the repo's checkout.
  - **Hunks:** staging, unstaging and discarding by hunk go through `git apply` with a patch built by `hunkPatch`. Only modified text files split into hunks.
  - **Protocol:** new `github.createPullRequest`. It opens a PR from the pushed current branch, with the base defaulting to the repo's default branch. It signs in with the GitHub CLI's token, on github.com only.
  - **Highlighter:** a small lexer per language family, with no dependency. Lines are lexed when drawn.
  - **Speed:** a 5,000-line diff takes 39–50 ms from click to first frame (budget 200 ms).
  - **Testing:** the macOS 26 snapshot references came from CI's artifact. `fake-picad` has a `review` scenario.
- **https://github.com/0zean/pica/pull/95 (A-09 Files and quick open, done):** spec in `docs/files.md`, package `app/Packages/Files`.
  - **Engine:** the production composition serves `files.list`, `files.read` and `files.quickOpen` (`core/src/files/`, `server/src/files-handlers.ts`) over R-08's `RepoFiles`. Each repo's listing is cached for 10 s. Quick open answers from the old listing while it lists again. There is no protocol change.
  - **Inspector:** AppShell's inspector now shows tabs of `InspectorPane`s that the app target supplies. Files is the first.
  - **Quick open:** File ▸ Quick Open… takes ⌘P from Print.
  - **Viewer:** each file opens in its own window (a non-editable `NSTextView`). The external editor opens through `NSWorkspace.open`; under `PICA_EXTERNAL_EDITOR_LOG` it is logged instead.
  - **Composer:** A-06's file and skill completions now work.
  - **Speed:** the slowest keystroke is 20–22 ms (budget 50 ms). The budget is asserted locally; CI (`CI=true`) asserts three times the budget, as a regression guard. Both benchmarks have a 60 s test timeout.
- **https://github.com/0zean/pica/pull/93 (A-14 Settings and command palette, done):** spec in `docs/settings.md`, package `app/Packages/PicaSettings`.
  - **Registry:** the action registry is the `ActionID` enum, with titles, menus and shortcuts in `ActionCatalog`, dispatched from `app/Pica/AppActions.swift`.
  - **Palette:** ⌘K opens it as a sheet: actions, then "Go to" each session.
  - **Keybindings:** saved in `config.jsonc` under `keybindings`. A shortcut is refused if it has no ⌘, ⌃ or ⌥, or if another action already has it.
  - **Settings:** two panes. General has the routing profile, tiers, budgets and permission mode; Keyboard has the shortcuts.
  - **Engine:** the production composition serves `config.get` and `config.set`, for the user layer only, editing `config.jsonc` in place. `ConfigValue` gains `lockedBy`. A set on a locked key answers `policy_denied` and names the policy. A-06's tier picker now writes `routing.tiers`.
- **Permissions:** auto mode blocked this session from adding Auto-fix and merge rules to `.claude/settings.json`. That file still doesn't exist. Side sessions were also denied turning on Auto-fix, so merges went through after the owner approved them or told sessions to go ahead.
- **Landing:** #92, then #93, then #94, then #95. Each merged with `gh pr merge <n> --merge --match-head-commit <sha>` after CI passed. #94 and #95 merged `main` in and kept both sides of the conflicts in `PicaApp.swift`, `project.pbxproj` and `app-graph.ts`.

## Key files for next session
- `/Users/nick/Documents/repos/pica/PLAN.md`: the §12 index and the notes under A-08, A-09 and A-14. Q-08 in §11.
- `/Users/nick/Documents/repos/pica/docs/review.md`, `/Users/nick/Documents/repos/pica/docs/files.md` and `/Users/nick/Documents/repos/pica/docs/settings.md`.
- `/Users/nick/Documents/repos/pica/tools/ui-tests/stage-engine.sh` and the `app-ui-test-*` targets in `/Users/nick/Documents/repos/pica/Makefile`.
- `/Users/nick/Documents/repos/pica/app/Pica/PicaApp.swift` and `/Users/nick/Documents/repos/pica/app/Pica/AppActions.swift`, where the app target wires in Review, Files and the action registry.
- Memory files touched: none.

## Running state
- Background processes, dev servers and ports: none.
- Side sessions, all idle with their PRs merged:
  - UI tests without a Documents grant: `local_a2cfd324-3669-4519-af3e-40ae8025008b`.
  - A-08: `local_03b7541d-6b77-442c-a8b9-f763085e5a12`.
  - A-09: `local_11b35a52-5bad-4ccf-ab35-22e86f405995`.
  - A-14: `local_dcd325d4-2384-4df9-b263-d59653254ecb`.
- Worktrees: the sessions reused older worktrees again, so the folder names don't match the units.
  - `.claude/worktrees/a-05-session-timeline-1e04db` is on `dev/a-08-review-6f819b`.
  - `.claude/worktrees/m-02-mcp-presets-9608d0` is on `dev/a-09-files-ae0c10`.
  - `.claude/worktrees/c-07-delegator-6533f3` is on `dev/a-14-settings-09a19a`.
  - `.claude/worktrees/m-07-mcp-import-f88fb7` is on `dev/ui-tests-no-documents-grant-7a1d8c`.
- All merged `dev/*` branches still exist on `origin`.
- UI-test stages live under `~/Library/Caches/dev.pica.ui-tests/`, one per checkout.
- This update is on `dev/handoff-6`, cut from `main` at `5855110`.

## Verification — how to confirm things still work
- `make verify-engine` passes. CI passed on #92–#95.
- These passed locally, each after merging `main`:
  - `make verify UNIT=A-08`.
  - `make verify UNIT=A-09`.
  - `make verify UNIT=A-14`, 3/3, with all 15 Pica UI tests.
- `make verify UNIT=A-06` and `make verify UNIT=A-07` pass with no Documents prompt after `tccutil reset SystemPolicyDocumentsFolder` for Pica's bundle ID.
- **Running UI tests locally:**
  - The display must be awake and unlocked.
  - Run one UI test run at a time, under one `lockf` lock.
  - `make app-ui-test-*` now register their own build, so you don't need to run `lsregister -f` yourself.

## Deferred + open questions
- **A-08:**
  - Until R-10, a session's worktree of a repo is the repo's checkout.
  - `github.createPullRequest` works only on github.com, using the GitHub CLI's token.
- **A-09:**
  - A session's worktree isn't shown apart from the checkout.
  - There is no filesystem watching, no syntax or match highlighting in the viewer, and no `skills.*` method.
- **A-14:**
  - `config.set` writes the user layer only. The workspace and repo layers aren't composed.
  - ⌘1–9 and the composer's keys can't be rebound.
- **C-11 (still `todo`):**
  - Make a `cost.delegation-limit` denial end the delegation.
  - Size the 5% reasoning-input margin against run-to-run noise.
- **A-07:** compose `permission.ask` and shell scope into `onPreToolUse`, so Copilot tool-call approvals reach the user.
- **From before (see the earlier handoffs, in git history):**
  - The H-05 crash backoff, and H-06 bundling.
  - A-04's missing broadcasts.
  - The C-04 gaps.
  - E-11's "not composed yet" list.
  - The C-07 `child_session` delegator, M-07's Codex import and M-02's GHE endpoint.
- **Open:**
  - The Auto-fix and merge permission rules for this repo: the owner has to add them to `.claude/settings.json`, because auto mode won't let an agent do it.
  - The product's `auto` tier choice and its price weighting.
  - Whether `smol-toml` may be added.
  - Whether to delete the merged `dev/*` branches and the stale worktrees.

## Pick up here
A-08, A-09 and A-14 are done. The next app units are in the `PLAN.md` §12 index: A-10, A-11, A-12, A-13 and A-16. X-01 and X-02 are now unblocked by A-14, and A-15 waits on A-12 and A-13. C-11 is the open cost-router work.
