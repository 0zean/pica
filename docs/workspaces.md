# Workspace and repo management (A-12)

Creating a workspace, adding a repo to it by path or URL, a team browser that imports GitHub teams with search and
multi-select, the sync status of a workspace's sources, and starting a session in a workspace (New Session, ⌘N). Code: `engine/packages/server/src/github-handlers.ts` and
`composition-workspaces.ts`, and the feature package `app/Packages/Workspaces`. It builds on R-03 (repo registry),
R-04 (GitHub auth), R-05 (team discovery) and R-06 (workspace model).

## Where it is

- **Sidebar.** Selecting a workspace shows its management screen in the session column: name and counts, New
  Session…, Add Repository…, Import Teams…, Sync with its status line, the sources with their last sync, and the repos
  with their clone state (Available, Cloning, Cloned, Clone failed) and a pin mark for pinned repos. The `+` menu in
  the sidebar's toolbar has New Session…, then New Workspace…, Add Repository… and Import GitHub Teams…, for the
  workspace the selection is in (or the only one).
- **Action registry (A-14).** `newSession` (⌘N), `newWorkspace` (⇧⌘N), `addRepository`, `importTeams` and
  `syncWorkspace`, in the File menu and the ⌘K palette. All but `newWorkspace` act on the selection's workspace, or the
  only one; with none they open New Workspace instead. Sync selects the workspace, so its status is visible.

The app target owns one `WorkspaceManager` (in `AppActions`), which holds the open sheet and one `WorkspaceStore` per
workspace, so a sync's status outlives the screen showing it. The workspace and its repos are not fetched by the
feature: the app target passes in what AppShell's `NavigationStore` holds, which follows `workspace.changed`
(`RootView`'s `workspaceContent` and `sidebarAccessory`, both optional).

## Adding a repo

One field takes either form (`RepoLocation`):

| Input | Meaning | Engine call |
|---|---|---|
| Starts with `/`, or is `~` or `~/…` | A folder on this Mac, used where it is (unmanaged). `~` expands to the home directory and the path is standardized. | `repo.addPath` |
| Contains `://`, or is `user@host:path` | A remote, cloned with `--filter=blob:none` into `~/Library/Application Support/Pica/repos/<org>/<repo>` (managed) | `repo.addUrl` (900 s timeout) |
| Anything else | Refused before asking the engine: a relative path has nothing to be relative to | — |

Either way the repo is then pinned (`workspace.pinRepo`), which broadcasts `workspace.changed`, so the sidebar and the
screen gain it. Choose Folder… fills the field from an open panel. A failure stays in the sheet with the engine's
message and code. Adding a repo the registry already has answers that repo, so pinning it again is harmless; adding
the local checkout of a team repo that is still `available` registers that checkout for the same repo.

## Team browser

On open it asks `github.authStatus`. Signed out, it shows "not signed in" with a **Sign in to `<host>`** fix and does
not list teams. Signed in, it lists `github.listTeams` (sorted by organization, then name) with a checkbox per team.

- **Search** keeps the teams whose name, `org/slug` contains every word of the query, ignoring case. Ticked teams stay
  ticked while the search hides them.
- **Multi-select.** Click a checkbox; Space ticks the focused row; ⌘A in the list ticks every visible team, or clears
  them when all are ticked. The footer counts the chosen teams.
- **Preview.** The focused team's repos (`github.listTeamRepos`, archived repos and forks left out as the sync leaves
  them out), or that call's error with its fix.
- **Import** adds a `team` source per chosen team (`workspace.addSource`; a team the workspace already has, answered
  `already_exists`, is skipped) and then syncs the workspace once. The new repos arrive as `available`, not cloned
  (PLAN.md §6). On success the sheet closes. If the sync fails the sheet shows the error with its fix and keeps the
  choice; the sources stay added, so Sync on the workspace screen retries them.

## New session

New Session… opens a sheet for the workspace (`NewSessionSheet` over a `NewSessionStore`, made afresh each time it
opens). It lives in this package because it needs only the workspace's repos and `session.create`; the app target
hands it the repos `NavigationStore` holds (`WorkspaceManager.repos`) and, once the engine answers, gives the session
to `NavigationStore.sessionCreated`, which holds it before its `session.changed` arrives and selects it, so the session
column opens its timeline and composer at once.

- **Repos.** Each of the workspace's repos is a row with Not used, Write or Reference. Only a repo with a local path can
  be a root (the engine's `session.create` refuses one that is not cloned), so a listed but uncloned repo, such as one
  a team import added, shows Not cloned and a Clone button: `repo.addUrl` with its remote clones it in place (900 s
  timeout), and the sheet keeps the answer, since no notification reports a clone. With exactly one usable repo the
  sheet starts with it as Write.
- **First prompt.** Optional; trimmed, and left out of `session.create` when empty, so the first message can be written
  in the composer instead.
- **Start** (⌘↩) is off, with the reason beside it, until a usable repo is Write or Reference. It calls
  `session.create {workspaceId, writeRepoIds, referenceRepoIds, prompt}` (60 s timeout, since the runtime opens before
  the answer), with the ids in the workspace's order. The routing profile and budget are the engine's defaults for the
  workspace.
- **Unavailable.** With no workspace, ⌘N opens New Workspace. With no repos the workspace screen's button and the `+`
  menu item are disabled, with "Add a repository to this workspace first." as their help; ⌘N still opens the sheet,
  which says so and keeps Start off.
- **Errors.** A failed `session.create` (the daily cap's `budget_exhausted`, a repo that is gone, a lost connection) is
  a `WorkspaceProblem` banner with its fix, as below; changing a repo's role clears it. A failed clone shows its own
  banner.

## Sync status

Per workspace, held by its `WorkspaceStore`:

| State | Status line |
|---|---|
| Never synced in this run | "Import a team to sync repos from GitHub." with no sources, else "Sync lists each source's repos on GitHub again." |
| Syncing | "Syncing…" with a spinner; Sync is disabled |
| Synced | "Up to date.", or "Synced: N repos added, M removed." |
| Failed | "Sync failed." and the error with its fix below |

Each source row shows "Synced just now", "Synced 5 minutes ago" (refreshed every 30 s) from its `lastSyncedAt`, or
"Not synced yet". Sync is R-06's `workspace.sync`: it saves nothing unless every source syncs, and a repo is matched to
one the store has by its normalized remote URL.

## Errors and their fix

Every failed request becomes a `WorkspaceProblem`: the message, the stable `code`, and `data.fix` when the engine
names one (PLAN.md §4.5). A banner shows the message and code, and the fix as a button labelled with the fix's
`label`. `FixPerformer` carries it out:

| `fix.kind` | Sent by | What the button does |
|---|---|---|
| `open_url` | SAML SSO 403 (`auth_sso_required`; target: the authorization URL), scope missing on a PAT | Opens the URL in the browser |
| `run_command` | Scope missing on the GitHub CLI's token (`auth_scope_missing`; `gh auth refresh … --scopes read:org`) | Copies the command and says to run it in Terminal, then try again |
| `sign_in` | No credential, or a rejected one (`auth_required`; target: the host) | Copies `gh auth login [--hostname <host>] --scopes read:org`, with the same note |
| `retry` | `github_request_failed`; a lost connection or timeout | Runs the request again |
| `open_settings` | — | Opens Settings |

The app never runs `gh` itself (PLAN.md §4.3); discovery signs in with the GitHub CLI's credentials. UI tests set
`PICA_FIX_ACTION_LOG`, and the performer appends `open_url <url>` or `copy <text>` to that file instead.

## Engine

The production composition now serves the three GitHub methods the protocol declared (`github-handlers.ts`), over the
same host and provider chain as discovery (`gitHubOptions` in `composition-workspaces.ts`):

| Method | Answer | Errors |
|---|---|---|
| `github.authStatus {host?}` | The first verified credential's provider, login and classic scopes; `signedIn: false` with nulls when the chain has none (`auth_required`) | Any other GitHub error with its fix |
| `github.listTeams {host?}` | `GET /user/teams`, all pages, sorted by org then name. Needs `read:org` | `auth_required`, `auth_sso_required`, `auth_scope_missing` (each with its fix), `github_request_failed` |
| `github.listTeamRepos {host?, org, teamSlug}` | `GET /orgs/{org}/teams/{slug}/repos`, all pages, archived repos and forks excluded as the sync excludes them | As above |

**Protocol change:** `host` is now optional on all three and defaults to the host the engine is set up for; a host
other than that answers `invalid_params` (`github.unknown_host`, with the configured `host`). The client does not know
which host that is, and the engine signs in to one. `GitHubAuthStatus.host` names it. Codegen regenerated.

**Broadcasts.** None added. Every A-12 change already reaches the sidebar through `workspace.changed`: create, pin,
add and remove source, and sync broadcast it. A-04's missing broadcasts (`workspace.delete`, repo registration without
a pin, clone state changes) stay missing: A-12 deletes no workspace and always pins what it registers. A clone started
by `repo.addUrl` finishes before the answer, so the repo arrives cloned.

**Host.** Production signs in to github.com through the GitHub CLI (`gh auth token`, or `GH_TOKEN`). `ProductionOptions`
takes a `github` (`GitHubAccessSettings`: host and providers) for tests; PATs from the Keychain and other hosts as user
settings are still a follow-up.

## Testing

- `fake-picad` starts the stub GitHub server in `engine/packages/server/tests/processes/fake-github.ts` when
  `PICA_TEST_GITHUB` is `signed-in` or `signed-out` (R-04's `startStubGitHub`), with host `ghe.example.test`. It serves
  acme/platform (atlas, beacon), acme/payments (ledger, billing), and vault-corp/vault, whose repos answer a SAML SSO
  403. Signed out, the provider has no token.
- `server/tests/workspaces/github-rpc.test.ts` runs the three methods, a team import, the SSO fix from both the browser
  and a sync, signed out, and an unknown host against that stub.
- `app/Packages/Workspaces/Tests`: the stores against a fake backend (search, multi-select, import order, skip of an
  existing source, a failed sync keeping its fix, signed-out sign-in fix, preview), `RepoLocation` table tests, the
  sync wording, and each fix kind.
- `PicaUITests/WorkspacesUITests`: imports two teams through the browser (search, ticks, import) and sees their four
  repos as Available; an SSO error shows Authorize for single sign-on and opening it logs the URL; signed out shows the
  sign-in fix; a repo added by path is pinned and Cloned; New Session… is off with no repos, then starts a session
  writing to the only repo with a first prompt and lands in it (composer on screen, the scenario's first turn in the
  timeline).
- `NewSessionStoreTests` (defaults, the reasons Start is off, uncloned repos never sent, the daily cap with its fix,
  cloning in place, the manager handing the session on) and AppShell's `SessionCreatedTests`.

## For A-15 (Onboarding)

- `github.authStatus` answers signed out without an error, so a precondition check can ask it directly.
- `WorkspaceProblem` and `FixPerformer` turn any engine error into a message and a working fix button; the private
  `ProblemBanner` view can be made public if onboarding shows the same banner.
- `WorkspaceManager.presentNewWorkspace()` and `createWorkspace(named:)` make the first workspace; `onCreated` selects
  it. `PICA_TEST_GITHUB=signed-out`, then `signed-in`, covers a GitHub precondition failing and then passing.
