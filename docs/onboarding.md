# Onboarding (A-15)

The first thing a new user sees: Pica checks what it needs before a first session, offers a fix for each check that
fails, and creates the first workspace. Code: the feature package `app/Packages/Onboarding`, the app target's
`app/Pica/AppOnboarding.swift`, and on the engine side `engine.git` (`engine/packages/server/src/git-install-handlers.ts`,
`adapters/src/git/probe-git.ts`). It builds on A-12 (workspace creation, fix actions) and S-01 (`engine.account`).

## When it is shown

Onboarding takes the main window's place while the engine has no workspace: once `NavigationStore` has loaded the
workspace list (so the engine is connected) and the list is empty. Creating the first workspace selects it, the list is
no longer empty, and the window shows the workspace's management screen (docs/workspaces.md), where repos are added and
teams imported. Nothing else is stored: a user who already has a workspace, made in the app or with the CLI, never
sees onboarding. **Set Up Later** hides it until Pica is next launched.

`PICA_ONBOARDING=off` turns it off. Every UI test but onboarding's own sets it (`PicaUnderTest`, and
`LaunchPerformanceTests`), since each starts with no workspace.

## The steps

The steps run in a fixed order: GitHub Copilot, Git, GitHub, then the first workspace. All three checks start together
when onboarding appears. The current step is the first check that has not passed, so passing a check advances to the next
one, or to the workspace when none is left. The step list shows every check's state: checking, passed, failed, or
skipped. The current step's card shows the engine's message, the fix as a button, and **Check Again**, which asks the
engine again.

| Check | Engine call | Passes when | Fix |
|---|---|---|---|
| GitHub Copilot | `engine.account` | `signed_in`, or `unknown` (a runtime with no accounts) | Copy `copilot login` |
| Git | `engine.git` | `installed` | Copy `xcode-select --install` |
| GitHub | `github.authStatus` | `signedIn` | Copy `gh auth login` for the engine's host (A-12's `sign_in`) |

- **Copilot.** `signed_out` and `no_models` both fail with the runtime's own message. With `no_models`, the account is
  signed in through the `gh` CLI token on Copilot Free, and `copilot login` fixes it (S-01).
- **GitHub is optional.** **Continue Without GitHub** skips it. Without it, repos can still be added by path or URL,
  but teams can't be imported.
- **Failed requests.** A failed request fails its check with the engine's message, and with `data.fix` when the engine
  names one. A `retry` fix checks again.

Fixes go through A-12's `FixPerformer`, which the app target hands in. Commands are copied for the user to run in a
terminal, with a note saying so under the message, because the app never runs them itself (PLAN.md §4.3). Under UI
tests, `PICA_FIX_ACTION_LOG` logs them instead.

The first workspace goes through `WorkspaceManager.createWorkspace(named:)`, the same path as New Workspace…, so it is
selected once created. If the engine refuses it, its message is shown under the name field.

## `engine.git`

`engine.git` takes no params and answers `{ git: { status, version, message } }`. `status` is `installed` or
`missing`. The engine runs `git --version` in the home directory with its own environment. A spawn failure or a
non-zero exit counts as `missing`, and `message` holds the first line git wrote to stderr. On macOS without the Command
Line Tools, `/usr/bin/git` is a stub that exits 1 and asks for them, so the check shows their install prompt too. The
answer isn't cached, so Check Again sees a fresh install. `ProductionOptions.gitInstall` stands in a probe for tests.

## Testing

- **Store tests.** `OnboardingStoreTests` covers the order of the steps, advancing, skipping GitHub, each outcome's
  message and fix, failed requests, fix notes, and creating the workspace. They run over a fake backend.
- **Engine tests.**
  - `core/tests/git/install.test.ts` covers the version parser.
  - `adapters/tests/git/probe-git.test.ts` runs the real git, a missing one, the macOS stub and a silent failure.
  - `server/tests/onboarding/git-install.test.ts` checks the production composition's `engine.git`.
- **UI tests.**
  - **`fake-picad`.** It reads `PICA_TEST_PRECONDITIONS` (`fake-preconditions.ts`) again on every check. The file
    holds a JSON object such as `{"copilot": "signed_out", "gitInstall": "missing", "github": "signed-out"}`, and a key that
    is absent passes. The FakeRuntime gets an `account` from it, `engine.git` answers from it, and the stub GitHub
    server's sign-in follows it.
  - **`OnboardingUITests`.** It fails all three checks. For each in turn, it checks that the fix is shown, performs
    it, makes the check pass and clicks Check Again, then sees the next step. It then creates the first workspace and
    sees its screen. A second test skips GitHub.
