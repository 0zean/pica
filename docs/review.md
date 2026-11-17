# Review (A-08)

The review shows what a session changed in the repos it writes, and takes it from there to a pull request: the
changed files, each file's diff unified or side by side with its syntax colored, staging and discarding a file or one
hunk at a time, then commit, push and open a pull request. It replaces the conversation in the session column; the
toolbar's **Review Changes** button (⇧⌘R) switches between the two.

The code is in `app/Packages/Review`, a feature package with the usual layering rule (PLAN.md §4.3: it depends on
`EngineClient`, `PicaProtocol` and `DesignSystem`, nothing else). The app target puts it in the session column in
`PicaApp.swift`. The engine side is `engine/packages/server/src/git-handlers.ts` over the R-01 git service.

The checks:

| Check | Where |
|---|---|
| Diff snapshots of the R-01 fixture repo: modified, renamed, deleted, binary, submodule and untracked files, the split layout, and highlighted code in each appearance | `DiffSnapshotTests` (Review) |
| The fixtures are what the engine sends for that repo | `git-rpc.test.ts` (server) |
| Rows, pairing and syntax state | `DiffDocumentTests`, `SyntaxHighlighterTests` |
| Store behavior over a fake engine | `ReviewStoreTests` |
| Hunk patches | `hunk-patch.test.ts` (core) |
| Stage, unstage, discard by hunk and file, commit, push and open a pull request against a real repo | `git-rpc.test.ts` |
| Stage one hunk, commit, and find the commit in a temporary repo | `ReviewUITests.testStagingAHunkAndCommittingRecordsTheCommit` |
| A 5,000-line diff draws in under 200 ms (§9) | `ReviewUITests.testA5000LineDiffRendersInUnder200Milliseconds`, and `DiffPerformanceTests` for the part that does not need SwiftUI |

`make verify UNIT=A-08` runs them all.

## Which repos

A session writes the repos it was created with (`session.create`'s `writeRepoIds`). Until R-10 gives sessions
worktrees of their own, a session works in the repo's checkout, so the session's worktree of a repo is the repo's
`localPath`, and `Session.writeRoots` in the protocol is still empty. The engine checks each `git.*` call against the
session's stored roots: reads (`git.status`, `git.diff`) take any root of the session, changes only a write root. A
repo that is not one answers `invalid_params` with `details.reason: "review.repo_not_in_session"`.

The review lists the workspace's cloned repos (`repo.list`) and keeps those whose `git.status` the engine answers for
the session. With more than one, a picker at the top of the file list switches between them.

## Data flow

`SessionReview` owns a `ReviewStore`. Engine calls go through `ReviewBackend`, which `EngineReviewBackend` implements
over `EngineClient`; the store's tests use a fake. Swift never runs git: every read and change is an engine call
(`tools/lint/swift-boundary.sh`).

After every action the store reloads `git.status` and both diffs (`git.diff` with `staged: true` and `false`), so what
is shown is always what git has, including changes made outside Pica. It also reloads when the session's state
changes (an agent's turn ended) and on ⌘R. The selection stays on the same file; if its last hunk moved to the other
list, it follows the file there.

| Action | Method | Notes |
|---|---|---|
| Changed files | `git.status`, `git.diff` | The unstaged diff includes untracked files, each shown against nothing (`git diff --no-index`), with change `untracked` |
| Stage, unstage, discard a file | `git.stage`, `git.unstage`, `git.discard` without `hunkIndexes` | Unstaging a rename unstages both paths. Discarding an untracked file deletes it (`git clean`); a tracked one goes back to its staged version (`git checkout --`) |
| Stage, unstage, discard a hunk | the same with `hunkIndexes` | Indexes into the hunks of the diff the client was shown |
| Commit | `git.commit` | Answers the new commit; a failure (a hook, nothing staged) keeps the message |
| Push | `git.push` | Pushes the current branch to its upstream's remote, or to `origin` with `--set-upstream` when it has none |
| Open a pull request | `github.createPullRequest` | New in A-08; see below |

Discarding asks for confirmation, since it cannot be undone.

## Hunks

`hunkPatch` (core) writes a patch with only the chosen hunks of a file's diff and the engine hands it to `git apply`:
`--cached` to stage, `--cached --reverse` to unstage, `--reverse` on the working tree to discard. Hunks left out move
the lines of the ones after them on the side the patch is not applied to, so their headers are adjusted; `git apply`
also searches near the stated line, so only the counts inside a hunk must be exact.

Only a modified text file splits into hunks. An added, deleted, renamed or binary file, a submodule, or a mode change
moves as a whole file; the engine refuses hunk indexes for one with `invalid_params` (`git.invalid_argument`), and the
review offers no hunk buttons for it. If the file changed after the client was shown its diff, the indexes may name
other hunks; the review reloads after each action, so this needs a change from outside Pica in between.

Git calls that change one repo run one at a time in the engine, since concurrent ones would both want its index lock.

## Pull requests

The protocol had no method for it, so A-08 adds `github.createPullRequest { sessionId, repoId, title, body, base?,
draft? } → { pullRequest: { number, url, head, base } }` (additive; Swift types regenerated). The engine:

1. Takes the head branch from `git.status`. A detached HEAD is `invalid_state`; a branch with no upstream is
   `invalid_state` with `reason: "review.not_pushed"`, so the review offers **Open Pull Request** only once the
   branch is pushed and nothing is left to push.
2. Takes the base from `base`, else the repo's default branch.
3. Takes `owner/name` from the repo's remote URL, which must be on the configured GitHub host (github.com for now;
   `reason: "review.not_on_github"` otherwise).
4. Signs in through the GitHub CLI's token (R-04's `gh` provider, `repo` scope) and calls R-10's pull request client.
   Sign-in errors keep their R-04 codes and `fix`.

The review then links to the pull request. Opening the link is the system's browser; the app makes no GitHub call.

## Drawing a diff

`DiffDocument` lays out a file's diff both ways once per selection: unified rows (each hunk's header, then its lines)
and split rows, where a run of removed lines is paired with the run of added lines after it and the shorter side is
left empty. Building it touches each line once and lexes nothing.

The rows go into a `LazyVStack` in a `ScrollView`, as the timeline does (A-05), so only the rows on screen are built.
Each row colors its line when it is drawn. Syntax state that crosses lines (block comments, strings over several
lines) is kept by `SyntaxStates`: a line's state depends on every line before it on its side (old: context and
removed, new: context and added), so it is worked out on demand, forward from the last line already known. The first
screen of a long diff reads only its first lines; scrolling to the end of a 5,000-line diff works out the rest once.
Each hunk starts from plain code, since hunks are not contiguous.

The highlighter (`SyntaxLanguage`) is a small lexer per language family, picked by file extension: keywords, strings,
comments and numbers, for Swift, TypeScript and JavaScript, JSON, Python, Ruby, Go, Rust, the C family and Java,
Kotlin, shell, YAML and TOML, and CSS. It knows no grammar, so a keyword used as a name is still colored. No
dependency was added: a grammar-based highlighter would cost more per line than this budget allows in Debug builds,
and the diff needs only these four tokens. Colors come from the palette (`accent`, `success`, `textSecondary`,
`warning`), so every appearance keeps its contrast; added and removed lines get a 14% tint of `success` and `danger`.

Lines wrap rather than scroll sideways. The layout picker is two buttons rather than a segmented picker, which
`ImageRenderer` cannot draw in snapshots.

### Measuring

`ReviewMetrics` (on only when `PICA_REVIEW_METRICS_PATH` is set, as the UI tests do) writes, for each file drawn, the
time from the click that selected it to the first frame that shows its diff: the selection time is taken in
`ReviewStore.select`, and the pane's `onAppear` schedules the measurement on the next turn of the main run loop, which
comes after the frame is committed. The UI test changes every line of a 2,500-line Swift file (2,500 removed and
2,500 added lines, one hunk), selects another file and then this one three times, and takes the median.

Measured on 2026-11-17 (Debug build, Apple silicon): click to first frame 39–50 ms over two runs (medians 50 and 39 ms). Building the rows of that diff takes about 4 ms in a Debug build (`DiffPerformanceTests`). Before line states were
worked out on demand, lexing every line up front took 130 ms in Debug (3 ms in Release).

## Not yet

- Sessions share the repo's checkout until R-10, so two sessions writing one repo review the same changes.
- Conflicts (`unmerged`) are listed and can be staged as a whole file once resolved; there is no merge view.
- No intra-line (word) highlighting of what changed within a line.
- Pull requests only on github.com with the GitHub CLI's token, as R-06's discovery does; other hosts and PATs follow
  R-04's wiring into the engine.
