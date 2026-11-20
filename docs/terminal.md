# Terminal (A-10)

A terminal panel for each session: a shell that starts in the session's worktree. Until R-10's worktrees are
reported, a session's worktree of a repo is that repo's checkout, as in A-08 and A-09. The panel shows the shell, says
which directory it started in, and closing it ends the shell.

The app side is the feature package `app/Packages/Terminal`, with the usual layering rule (PLAN.md §4.3; rule in
`engine/tools/lint-arch/app-graph.ts`). The app target places it in `PicaApp.swift`. On the engine side it is
`session.roots` (`core/src/sessions/roots.ts`, `server/src/session-roots-handlers.ts`).

| Check | Where |
|---|---|
| A command's output appears, and `pwd` prints the worktree | `TerminalUITests.testACommandsOutputAppearsAndItRunsInTheWorktree`, `TerminalShellTests` |
| Closing the panel ends the shell process | `TerminalUITests.testClosingThePanelEndsTheShell`, `TerminalShellTests`, `SessionTerminalsTests` |
| `session.roots` | `core/tests/sessions/roots.test.ts`, `server/tests/sessions/roots.test.ts` |

`make verify UNIT=A-10` runs all of them.

## Where the panel goes

It opens at the bottom of the session column, under the conversation or the review, in a `VSplitView`. The toolbar's
**Terminal** button (⌃`) opens and closes it.

- **Not an inspector pane (A-09's `InspectorPane`).** A shell needs about 80 columns, roughly 600 pt at 12 pt
  monospaced, and the inspector is narrower than that. It also switches between panes and rebuilds the chosen one for
  each workspace, and a shell must not end because another tab was picked.
- **Not a session-column mode (A-08's review).** The review replaces the conversation, which suits a diff. A terminal
  is used *while* reading the agent's work, so it sits under the conversation or the review instead of replacing either.

## Where the shell runs

The pseudo-terminal and the shell live in the app, which is not sandboxed. Pica runs them with SwiftTerm's
`LocalProcessTerminalView`, which does the `forkpty`, the emulation and the drawing.

- **Why not the engine.** Node has no pseudo-terminal API. The usual add-on, `node-pty`, is a native module that isn't
  on PLAN.md §8's dependency list and would complicate H-06's bundling. Every keystroke and every screenful would also
  cross the socket for nothing, since the user is the one typing.
- **What PLAN.md §4.3 still holds.** Swift itself never runs git, reads repo files or calls GitHub. The shell is the
  user's own: Pica starts it and passes keystrokes, as Terminal.app does. The engine still decides where it starts
  (below).

### Starting

1. When the panel opens, it asks the engine for `session.roots`.
2. It starts the shell in the first root, which is also where the session's agent runs.
3. With more than one root, a menu in the panel's header switches to another. Switching ends the shell and starts one
   in the chosen directory.

The shell is the user's login shell: `SHELL` from Pica's environment, else the account's shell (`getpwuid`), else
`/bin/zsh`. It runs as a login shell (`argv[0]` is `-zsh`), so the user's profile sets `PATH`, as in Terminal.app.

Its environment is built for a terminal rather than passed through from Pica (`ShellLaunch`):

- **Passed on from Pica:** `HOME`, `USER`, `LOGNAME`, `PATH`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, `SSH_AUTH_SOCK`.
- **Set by Pica:** `SHELL`, `PWD` (the directory), `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=Pica`.
  `LANG` is set to `en_US.UTF-8` when Pica has none.
- **Never passed on:** Pica's own `PICA_*` variables and anything else in its environment.

### Ending

Closing the panel (its × or the toolbar button) ends the shell, as closing a Terminal.app window does:

1. Pica sends `SIGHUP` to the shell. An interactive shell passes the hang-up on to its jobs and exits.
2. If the shell is still there after 2 s, for example because it traps or ignores `SIGHUP`, Pica sends `SIGKILL`.
3. Until the shell has exited and been reaped, `SessionTerminals` keeps it. SwiftTerm reaps the child from its exit
   monitor, and dropping the view earlier would leave a zombie.

SwiftTerm's own `terminate()` isn't used: it sends `SIGTERM`, which interactive shells ignore, and it cancels the exit
monitor, so the process is never reaped.

When Pica quits, the pseudo-terminal's master closes and the kernel hangs up each shell.

If the shell exits by itself (`exit`, or `^D`), the panel stays open. The header says how it ended and offers
**New Shell**.

### Sessions

`SessionTerminals` keeps one panel per session for as long as Pica runs. Switching to another session and back
shows the same shell with its screen. Only closing the panel ends it. Ending a session doesn't close its terminal.

## Protocol

`Session.writeRoots` is still empty until R-10 (`TODO(R-10)` in `core/src/sessions/info.ts`), so A-10 adds one
method. The change is additive, and the Swift types are regenerated.

```
session.roots { sessionId } → { roots: [{ path, access: "write" | "reference", repoId | null }] }
```

- **Order:** write roots first, then reference roots, each in the order the session was created with. The first is
  where the session's agent runs.
- **`repoId`:** the registered repo whose checkout is at `path`.
- **Errors:** a session that doesn't exist answers `not_found`.

## Accessibility

The terminal view (`pica.terminal.view`) is a text area whose value is the visible screen, with lines the terminal
wrapped joined back together. VoiceOver reads it that way, and the UI tests read it too.

The header's directory (`pica.terminal.directory`) has the full path as its value.

## SwiftTerm

`https://github.com/migueldeicaza/SwiftTerm`, pinned exactly at 1.18.0 (2026-08-09). It is on PLAN.md §8's list of
expected dependencies.

- **Why this release:** it's the newest one that doesn't run a build-tool plugin on its library. From 1.19 on, a
  build-info plugin makes Xcode ask the user to trust it, and `xcodebuild` needs `-skipPackagePluginValidation`.
- **What it brings in:** `swift-argument-parser` for its own command-line tool, which Pica doesn't build.
- **Metal:** since 1.12, SwiftTerm compiles a Metal shader for its optional Metal renderer. Pica doesn't use that
  renderer, but the shader is built anyway, so building Pica needs Xcode's Metal Toolchain. From Xcode 26 on it's a
  separate download, once per machine: `xcodebuild -downloadComponent MetalToolchain`. CI's `verify-app` job installs
  it when it's missing.
- **The newest release without Metal (1.11.2)** was ruled out. It resolves `package-benchmark` and its dependencies,
  keeps `BufferLine.isWrapped` internal, and has a race in the exit monitor that later releases fix.

## Not done

- ⌃` is a plain shortcut on the toolbar button, like A-08's ⇧⌘R, not an `ActionID` in A-14's registry, so it can't be
  rebound yet.
- One shell per session, with no tabs or splits.
- The shell isn't sandboxed to the session's roots (R-07's scope applies to the agent's tools, not to the user).
- The shell doesn't follow the session into R-10's worktrees yet. Once `session.roots` reports them, it will without
  any change on the app side.
