# Session Handoff — A-15, A-16, X-01 and X-02 landed

## Where it started
The owner asked to review `PLAN.md` and the previous handoff and start A-15, A-16, X-01 and X-02 in parallel sessions. Each unit ran in its own worktree session. The owner then asked to merge them in order. All four PRs are merged into `main`, landed as #102, #103, #104, #105; `main` is at `162bf7c`.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/102 (X-01 Themes and density, done):** spec in `docs/themes.md`.
  - **UI:** Settings ▸ Appearance (A-14's scene) has a theme picker, density (Compact / Regular / Comfortable), an accent well and a live preview. It writes `appearance.theme`, `.density` and `.accent` through `config.get`/`config.set`, and shows managed locks like the General pane.
  - **DesignSystem:** every `Palette` role carries a `ThemeToken` and resolves through the environment's `picaTheme`, so views drawing with `Palette` follow the theme unchanged. Density scales component padding (×0.75 / ×1 / ×1.25); Regular is A-03's layout unchanged.
  - **Every window** gets `.modifier(AppearanceHost(store: actions.appearance))` in `PicaApp.swift`. New windows must add it too (A-16 and X-02 did when they merged).
  - **Theme files:** JSONC in `~/Library/Application Support/Pica/themes/`, validated by the app (`ThemeFile`). An unknown token, appearance or key, or a non-`#RRGGBB` color, is an error naming it. Example: `docs/themes/harbor.jsonc`.
  - **Custom accent:** `onAccent` picks white or dark; the pane warns under 3:1 contrast.
  - **Engine:** the config schema gains a lockable `appearance` key.
  - **Snapshots:** the five new macOS-26 references came from CI's `snapshot-failures` artifact (commit `f33cf54`), as with A-03/A-11.
- **https://github.com/0zean/pica/pull/103 (A-16 Session overview, done):** spec in `docs/session-overview.md`, package `app/Packages/SessionOverview`.
  - **UI:** Window ▸ Session Overview (⇧⌘O, `showSessionOverview`). A "Needs You" queue on top (awaiting approval first, then failed, longest waiting first), then Working, Idle and Stopped lanes. Clicking a card selects the session in the main window.
  - **Fan-outs tab:** each R-11 run with a progress ring, counts, state, Cancel while running, and a row per repo.
  - **Data:** `NavigationStore` for sessions, workspaces and repos; `fanout.list` and `fanout.changed` through `FanOutStore`. No engine or protocol change.
  - **Idle cost:** nothing animates while nothing changes. 20 FakeRuntime sessions measured 0.14–0.15% of a core (debug build, under the UI-test lock). `OverviewMetrics` measures it only with `PICA_OVERVIEW_METRICS_PATH`.
  - **Testing:** `fake-picad` scenario `overview`. The UI test reads card order from frames, since XCUITest's element order isn't visual order.
- **https://github.com/0zean/pica/pull/104 (A-15 Onboarding, done):** spec in `docs/onboarding.md`, package `app/Packages/Onboarding`.
  - **UI:** shown in place of the main window (`OnboardingGate` in `PicaApp.swift`) while the engine has no workspace. Steps: Copilot sign-in (`engine.account`), Git (`engine.git`), GitHub (`github.authStatus`), first workspace. The current step is the first failing check; each shows its fix action and Check Again.
  - **Optional paths:** Continue Without GitHub, and Set Up Later (hides it until next launch).
  - **Reuse:** A-12's `FixPerformer` and `WorkspaceManager.createWorkspace` (`AppOnboarding.swift`).
  - **Engine/protocol:** new `engine.git` (`installed | missing`, version, message) runs `git --version`; a failed run counts as missing, which covers the `/usr/bin/git` stub without Command Line Tools. `ProductionOptions.gitInstall` replaces the probe in tests. The protocol version isn't bumped.
  - **Testing:** `PICA_TEST_PRECONDITIONS` names a JSON file `fake-picad` rereads on each check. `PicaUnderTest` and `LaunchPerformanceTests` set `PICA_ONBOARDING=off` unless a test asks for onboarding.
- **https://github.com/0zean/pica/pull/105 (X-02 Agents, skills and rules management, done):** spec in `docs/agents.md`, package `app/Packages/Customization`.
  - **UI:** Window ▸ Agents & Skills (⇧⌘A, `showCustomization`). Lists agents, skills and instruction files for the user, a workspace or one of its repos, with each item's layer and status (Wins / Active / Overridden by … / Invalid: … / Applies). Edit, revert, delete and a New sheet per kind.
  - **Engine:** core and adapters `customization/`; the production composition serves `customization.list/create/save/delete`. Writes are validated with C-02's parser and `validateAgent` in the target layer and refused as `config_invalid` with `details.problems`. `save`/`delete` accept only paths the listing returned.
  - **Protocol:** new `dto/customization.ts` and a `customization.*` namespace, added to `NAMESPACES` and `PLAN.md` §4.5.
  - **Managed policy:** new `customization.locked` (kinds), shown as locked by the policy and refused with `policy_denied` (`docs/managed-policy.md`).
- **Landing:**
  - **Order:** #102, #103, #104, #105, each merged from this session with `gh pr merge <n> --merge --match-head-commit <sha>` after the owner asked.
  - **How:** after each merge, the next unit's session merged `origin/main` into its branch, kept both sides of conflicts in the shared files (`PLAN.md` index rows, `app-graph.ts`, `ActionID`, `PicaApp.swift`), passed the full `make verify` locally under the UI-test lock, and pushed. Each PR merged only after CI passed at that head.
  - **Locked screen:** A-15's first post-merge run failed in `GalleryAccessibilityTests` with "Failed to activate application" because the Mac's screen was locked. It passed (all 36 UI tests) after the owner unlocked it.

## Key files for next session
- `/Users/nick/Documents/repos/pica/PLAN.md`: the §12 index and the notes under A-15, A-16, X-01 and X-02.
- `/Users/nick/Documents/repos/pica/docs/themes.md`, `/Users/nick/Documents/repos/pica/docs/session-overview.md`, `/Users/nick/Documents/repos/pica/docs/onboarding.md` and `/Users/nick/Documents/repos/pica/docs/agents.md`.
- `/Users/nick/Documents/repos/pica/app/Pica/PicaApp.swift` and `/Users/nick/Documents/repos/pica/app/Pica/AppActions.swift`, where the app target wires in the four new packages and actions.
- Memory files touched: none.

## Running state
- Background processes, dev servers and ports: none.
- Side sessions, all idle with their PRs merged:
  - X-01: `local_97d2c9a7-05f2-4396-99a0-cb8901c22f30`.
  - A-16: `local_1ba69b76-d5d7-4707-a89a-bcd8d46319f9`.
  - A-15: `local_68fd15e6-2997-4d5b-bc7a-a420862b1545`. It turned on Auto-fix for #104, which is now merged.
  - X-02: `local_11b49772-f4b3-480f-8827-badc3cff3879`.
- Worktrees: the folder names don't match the units.
  - `.claude/worktrees/c-07-delegator-6533f3` is on `dev/x-01-themes-density-259cde`.
  - `.claude/worktrees/a-05-session-timeline-1e04db` is on `dev/a-16-session-overview-676126`.
  - `.claude/worktrees/a-13-mcp-management-e71650` is on `dev/a-15-onboarding-2bee5b`.
  - `.claude/worktrees/m-02-mcp-presets-9608d0` is on `dev/x-02-agents-skills-rules-d579f9`.
- All merged `dev/*` branches still exist on `origin`, including `dev/handoff-3` to `dev/handoff-7`.
- This update is on `dev/handoff-8`, cut from `main` at `162bf7c`.

## Verification — how to confirm things still work
- CI passed on #102–#105 at their merged heads.
- #105's head (`5d2d60c`) included the other three, and the full `make verify` passed on it locally.
- `make verify` has not been run on `main` at `162bf7c` itself (it is #105's head plus the merge commit).
- **Building the app:** needs the Metal Toolchain (`xcodebuild -downloadComponent MetalToolchain`).
- **Running UI tests locally:**
  - The display must be awake and unlocked; a locked screen fails with "Failed to activate application".
  - Run one UI test run at a time, under `lockf /tmp/pica-uitest.lock`.
- **New snapshots:** macOS-26 references come from CI's `snapshot-failures` artifact; the first `verify-app` run fails until they are committed.
- **Known timing flakes:**
  - A-09's quick-open benchmark, under load locally.
  - A-01's engine-recovery timing, on CI runners.

## Deferred + open questions
- **X-01:**
  - No code font or size setting (§7.4).
  - Views using `Spacing` constants directly don't scale with density.
  - The composer's AppKit text view doesn't follow the theme.
  - The themes folder isn't watched.
- **A-16:**
  - Cards name no repo until R-10 fills `writeRoots`.
  - Nothing in the app or CLI starts a fan-out yet.
- **A-15:** none listed in its PR beyond the optional GitHub step.
- **X-02:**
  - Sessions get only built-in and user agents, loaded at engine start, so a new or edited agent applies after a restart.
  - Workspace and `.pica/agents` agents are listed but not given to sessions yet.
  - No file watching.
- **Still open from before:**
  - A-10 to A-13 deferrals (see the previous handoff in git history).
  - C-11's delegation-limit denial and reasoning-input margin.
  - A-07's `permission.ask` and shell scope in `onPreToolUse`.
  - M-02's GHE endpoint and M-07's Codex import.
  - H-05's crash backoff and H-06 bundling.
- **Open:**
  - The Auto-fix and merge permission rules for this repo. Side sessions still don't merge; this session merged after the owner asked.
  - The product's `auto` tier choice and its price weighting.
  - Whether `smol-toml` may be added.
  - Whether to delete the merged `dev/*` branches and the stale worktrees.

## Pick up here
All Phase 5 and Phase 6 units are done. What's left in §12 is C-11 (built; live gate not met), H-05 Reliability, H-06 Distribution, H-07 Performance gate (all A units now done) and H-08 Documentation (needs M4). Milestone M4 is a manual end-to-end run by the owner: import a team, start a session, approve a tool call, review the diff, commit, open a PR, read the session's cost.
