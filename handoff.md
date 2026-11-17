# Session Handoff — A-06, A-07 and C-11 landed: the app has a composer and actionable approvals; `balanced` now passes the credit gate but not the reasoning-input gate

## Where it started
The owner asked to review `PLAN.md` and the previous handoff, then run A-06 (composer), A-07 (approvals) and C-11 (make `balanced` pass the D-21 gate) in parallel side sessions. All three opened PRs. The owner approved C-11's live run in its own session, then asked for the PRs to be merged and this handoff updated.

## Decisions locked + what shipped
- **https://github.com/0zean/pica/pull/88 (A-07, done):** spec in `docs/approvals.md`.
  - **Cards:** the A-05 approval row now has Allow Once / Always Allow / Deny, and Raise Budget / Stop for a budget approval. It names the call it is for. If the engine refuses a choice, the card stays pending and shows the reason.
  - **Notifications:** `ApprovalNotifier` (AppShell) posts one `UserNotifications` notification when a session enters `awaiting_approval`, and withdraws it when the session moves on.
    - Nothing is posted while Pica is frontmost.
    - Permission is asked for on the first post. `PICA_NOTIFICATIONS=off` turns notifications off; the UI tests set it.
  - **Engine and config:**
    - New config key `permissions.tools: [{ tool, match?, permission }]`.
    - `allow_always` appends a rule with `appendPermissionRule`. It edits the user's `config.jsonc` in place with `jsonc-parser`, keeping comments, and writes atomically.
    - A prompt that matches a rule is answered at once and recorded as a `policy.decision` (`permission.rule`). A rule never overrides a policy deny.
    - If the rule can't be written, the approval stays pending.
  - **Testing:** FakeRuntime steps take `asks`. `fake-picad` has an `approvals` scenario.
  - **Known limit:** production doesn't compose `permission.ask` or shell scope into `onPreToolUse` (E-11's list), so with Copilot, tool-call approvals may not reach the user yet. Budget approvals do.
- **https://github.com/0zean/pica/pull/90 (C-11, built; live gate not met):**
  - **Caps:** `routing.delegation.codeWriter` (`maxToolCalls` 12, `maxWriteBytes` 32768) caps one `code-writer` delegation. Calls past it are denied with `cost.delegation-limit`.
  - **Prompts:** `code-writer`'s prompt is now "apply a precise spec, don't explore". The delegation guide puts the rules first, and says to run `mkdir -p` before delegating a new file. The `cost.large-read` and `cost.shell-write` deny reasons name the next call to make.
  - **Report names:** `EVAL_REPORT_NAME` names a report's files.
  - **Live result (`docs/evals/2026-11-17-c11-live.md`):** 3 runs × 15 tasks, same pin as C-10 (`gpt-5.6-luna` / `auto`), about 45 credits.
    - Tasks: 15/15 against 15/15.
    - Credits: **+27.1%** (C-10: +179%), within the 35% limit. The margin is 0.52 credits per suite run.
    - Reasoning-tier input: **+8.4%** against the 5% limit, which fails. One task's input varies by more than the whole margin from run to run.
  - **The credit pass depends on `sed -i`:** the main agent edited with `sed -i` or scripts in 8 of 45 `balanced` runs, and in 6 of 45 under `off`. `cost.shell-write` doesn't classify either. This model never calls `edit`, and `balanced` hides `apply_patch`.
  - **D-23 (`PLAN.md` §3), tried and reverted:** keep `apply_patch` under `balanced` and deny patches that add a file. The probe (`docs/evals/2026-11-17-c11-patch-probe.md`) showed patches cost far more than `sed -i`: 4.67 against 0.53 credits on `rename-fmt-cents`. So `sed -i` stays unclassified, by design.
  - **Default:** still `off` (D-22). The owner hasn't been asked to make `balanced` the default, and this run doesn't support it.
- **https://github.com/0zean/pica/pull/89 (A-06, done; marked in the index by this handoff's PR):** spec in `docs/composer.md`.
  - **Package:** new feature package `app/Packages/Composer`, wired in by the app target under the timeline in `SessionContent`. Neither AppShell nor Timeline depends on it.
  - **Input:** an `NSTextView` that grows from one line to eight. Unsent text is kept per session.
  - **Mentions:** `@` mentions repos, files and agents, and `/` runs skills. `MentionTokenizer` has table tests.
  - **Keys:** ⌘↩ sends, or queues while a turn runs. ⇧⌘↩ steers and ⌘. stops.
  - **Pickers:** the profile picker sets the workspace default. The tier picker is read-only, because `config.set` isn't served.
  - **Engine:** the production composition now serves `agents.list`, `models.list` and `models.tiers` (`catalog-handlers.ts`). There is no protocol change.
  - **Latency:** keystroke to glyph has a median of 12.9–13.3 ms and a p95 of 13.5–15.2 ms (budget 16 ms; the worst run had 0.8 ms to spare). It's measured inside Pica by `ComposerMetrics`.
  - **Also changed:** `ScrollFollow` treats "at bottom" as within 9 points instead of 8.
  - **Fix found while landing (`5359bcc`):** with the composer making the timeline shorter, a lazily built row that grew after being scrolled to was left partly below the viewport, and that hid A-07's Deny button. While following, the timeline now scrolls to the newest row again whenever the content grows. `ApprovalsUITests` now checks the newest card instead of counting cards.
- **Landing:** #88, then #90, then #89, each merged with `gh pr merge <n> --merge --match-head-commit <sha>` after CI passed. #89 conflicted with #88 in five files; the A-06 session merged `main` in and kept both sides.

## Key files for next session
- `PLAN.md`: C-11 and its notes, D-23 in §3, and the §12 index.
- `docs/evals/2026-11-17-c11-live.md` and `docs/evals/2026-11-17-c11-patch-probe.md`.
- `docs/approvals.md` and `docs/composer.md`.
- `app/Packages/Composer/` and `app/Packages/Timeline/` (the approval cards). Also `app/Packages/AppShell/`, which holds `ApprovalNotifier`.
- `engine/packages/server/src/catalog-handlers.ts` and the permission-rule writer, with `permission-rules.test.ts` and `permission-rule-writer.test.ts`.
- `engine/packages/server/tests/processes/fake-picad-scenarios.ts`, which has the `approvals` and `composer` scenarios.
- Memory files touched: none.

## Running state
- Side sessions:
  - A-06 (`local_8917fbd7-2e24-47ba-b0f0-ca2506920958`), A-07 (`local_6460eaf1-331f-480c-a5ea-0c5786f6b102`) and C-11 (`local_9d287657-0dbe-4502-accd-aeb92cb9152c`) are idle, with their PRs merged.
  - Auto-fix is on for #89 only.
- Background processes, dev servers and ports: none.
- Worktrees: the sessions reused older worktrees, so the folder names don't match the units.
  - `.claude/worktrees/a-05-session-timeline-1e04db` is on `dev/a-06-composer-6baa81`.
  - `.claude/worktrees/m-02-mcp-presets-9608d0` is on `dev/a-07-approvals-066d1e`.
  - `.claude/worktrees/m-07-mcp-import-f88fb7` is on `dev/c-11-balanced-gate-44da10`.
  - `.claude/worktrees/c-07-delegator-6533f3` is at a detached head.
- All merged `dev/*` branches still exist on `origin`.
- This update is on `dev/handoff-5`, cut from `main`.
- Live eval runs wrote to the owner's real Pica data directory under `~/Library/Application Support/Pica/`.

## Verification — how to confirm things still work
- `make verify-engine` passes. CI passed on #88, #89 and #90.
- `make verify UNIT=A-07` passed locally twice, and A-04's tests stay 3/3.
- `make verify UNIT=A-06` passes locally, with all three checks.
- `make verify UNIT=C-10` and `make verify UNIT=C-11` pass their deterministic checks. The live checks are skipped unless `PICA_LIVE=1`.
- **Running UI tests locally:**
  - **Documents access:** no longer needed (Q-08). `make app-ui-test-*` build into, and run the engine from, a stage under `~/Library/Caches/dev.pica.ui-tests/`, so a rebuilt Pica raises no "access files in your Documents folder" prompt. Running PicaUITests from Xcode with derived data and the engine under `~/Documents` still asks.
  - **Display:** the Mac's display must be awake and unlocked. Otherwise XCUITest stalls at its first window query, and `screencapture` fails.
  - **One run at a time:** two sessions' UI runs kill each other's Pica. Run them under one `lockf` lock.
  - **Register first:** worktrees share a bundle ID, so XCUITest may launch another worktree's app. `make app-ui-test-*` now run `lsregister -f` on their own build before testing.
- **Snapshots:** #88 changed `event-approval.requested` and `event-budget.exhausted`, and added `approval-pending-{light,dark}`. Their macOS 26 references came from CI's `snapshot-failures` artifact, and `verify-app` passed on #88.

## Deferred + open questions
- **C-11 (still `todo`):**
  - Make a `cost.delegation-limit` denial end the delegation. In one run `code-writer` kept calling `view` through 24 denials.
  - Size the 5% reasoning-input margin against run-to-run noise: more runs, or a margin taken from `off` against itself.
- **A-07:** compose the permission-mode rules (`permission.ask`, shell scope) into `onPreToolUse`, so Copilot tool-call approvals reach the user. This is a separate unit.
- **A-06:**
  - `files.quickOpen` and `files.list` need a search adapter (A-09). Until then there are no file or skill completions.
  - `config.set` isn't served, so the tier picker is read-only.
- **From before (see the previous handoff, in git history):**
  - The H-05 crash backoff, and H-06 bundling.
  - A-04's missing broadcasts.
  - The C-04 gaps: interpreter one-liners and unresolved targets. `sed -i` is now unclassified by design (D-23).
  - E-11's "not composed yet" list.
  - The C-07 `child_session` delegator, M-07's Codex import and M-02's GHE endpoint.
- **Open:**
  - The product's `auto` tier choice and its price weighting.
  - Whether `smol-toml` may be added.
  - Whether Auto-fix and the merge step should be allowed in this repo's permission settings.
  - Whether to delete the merged `dev/*` branches and the stale worktrees.

## Pick up here
A-06 and A-07 are done. The rest of C-11 is the open cost-router work. The next app units are in the `PLAN.md` §12 index (A-08 needs R-01).
