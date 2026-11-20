# MCP management (A-13)

Managing MCP servers in the app: the catalog of optional presets, adding and editing servers, pasting a server snippet,
importing from other agent platforms, signing in, attaching servers to a workspace or a session, each server's
token cost, and its health. Pica works with no server attached (D-18); everything here is opt-in.

Code: `engine/packages/core/src/mcp-manage/` (the manager, `mcp.jsonc` entries, runtime servers),
`engine/packages/server/src/mcp-composition.ts`, `mcp-manage-handlers.ts` and `composition-mcp.ts`, the adapters
`adapters/src/config/mcp-server-files.ts` and `mcp-attachment-store.ts`, and the feature package `app/Packages/McpServers`.
It builds on M-01 (registry, [mcp-configuration.md](mcp-configuration.md)), M-02 ([mcp-presets.md](mcp-presets.md)),
M-03 ([mcp-secrets.md](mcp-secrets.md)), M-04 ([mcp-tool-budgets.md](mcp-tool-budgets.md)), M-05
([mcp-permissions.md](mcp-permissions.md)), M-06 ([mcp-health.md](mcp-health.md)) and M-07 ([mcp-import.md](mcp-import.md)).

## Where it lives in the app

- **The MCP Servers window** (Window ▸ MCP Servers, ⇧⌘M, `ActionID.showMcpServers`). A table of servers, global or
  for the chosen workspace, with scope, health, tool count, token cost and, for a workspace, whether new sessions get
  the server. Add Server offers each preset, a custom server, a pasted snippet, and an import from other apps. Each row
  has Edit, Sign In (for a remote server with no Authorization header of its own that needs it), Check Now and Remove.
- **The inspector's MCP pane**, for the selected session: its workspace's servers as checkboxes, each with its token
  cost and health, and the session's total. Manage Servers… opens the window.

Why a window and not a Settings pane: Settings (A-14) edits the user layer of `config.jsonc` in a fixed 560 × 480
pane and knows nothing of workspaces or sessions. MCP servers live in their own files at two scopes, have live health
that changes while the window is open, need a wide table for the token-cost column, and are added through sheets
(presets, editor, import). Why the session part is in the inspector: attaching is about one session, which only the
main window's selection knows, and the inspector is where the session's other context (files, later usage) is.

## Methods

The production composition now serves every `mcp.*` method. New or changed in A-13 (protocol and Swift codegen):

| Method | What it does |
|---|---|
| `mcp.list {workspaceId?}` | Resolved servers (M-01): the Copilot CLI's and Pica's global files, and the workspace's own file over them when `workspaceId` is given. Repo-scope files are not listed (see Limits). |
| `mcp.add {server, workspaceId?}` | Writes the server into `mcp.jsonc` at its scope: `global`, or `workspace` with `workspaceId`. `already_exists` when the id is taken there; `invalid_params` for a `repo` scope or a `workspace` scope without an id. |
| `mcp.update {server, workspaceId?}` | Replaces an existing entry; `not_found` when there is none. |
| `mcp.remove {id, workspaceId?}` | Removes it from the workspace's file, or the global one, and detaches it from every workspace and session. |
| `mcp.attachments {sessionId? \| workspaceId?}` | What is attached there, and the tool-definition tokens it adds to each prompt; null while a server's tool list is unknown. |
| `mcp.attach {serverId, sessionId? \| workspaceId?, agent?, acknowledgeCacheReset?}` | Attaches, answering the server's tool-definition tokens. |
| `mcp.detach {…same}` | Detaches. |
| `mcp.status`, `mcp.statusList`, `mcp.restart`, `mcp.statusChanged` | M-06, now composed: every global and workspace server is checked. |
| `mcp.login {id}` | M-03's browser sign-in, now composed (see Signing in). |
| `mcp.presets`, `mcp.renderPreset`, `mcp.importCandidates`, `mcp.import` | M-02 and M-07, unchanged. |

Exactly one of `sessionId` and `workspaceId` is given to the attachment methods; otherwise `invalid_params`.
Writes go through M-01's rules: an entry is read back through `buildMcpDefinitions` before it is written, so an inline
secret is refused (`config_invalid`, naming the key path, never the value) just as it is in a hand-edited file. Files
are edited in place with `jsonc-parser`, keeping comments, and written atomically with mode 0600.

`ErrorCode` gains `cache_reset_unconfirmed`.

## Attaching, and the cache warning

Attachments are engine state, not user config: `mcp-attachments.json` in Pica's data directory, beside the store,
records `{serverId, agent}` per workspace and per session.

- A **workspace's** servers are copied into each session created in it, once, at creation. Changing the workspace
  later changes only sessions created after that, so it never touches a running session's cache.
- A **session's** servers are what its runtime starts with: M-04's plan (`attachMcpServers`, with M-05's managed
  allowlist) becomes the runtime's `mcpServers`, and agent-scoped ones join the delegator's agent of that name. A
  session with nothing attached gets no `mcpServers` key at all.

PLAN.md §5.5: the tool set is fixed at session start, and any change to it invalidates the prompt cache. So a change
to a **live** session (`starting`, `idle`, `running`, `awaiting_approval`) is refused with `cache_reset_unconfirmed`
(`details.toolDefinitionTokens`) unless the call says `acknowledgeCacheReset: true`. The app's pane never sends the
change first: on a live session it shows "Reset this session's prompt cache?", naming the server, its token cost, and
that the next turn pays full input price for the whole conversation. Only Change Servers sends the change, with the
acknowledgement. If the engine still refuses (the session went live since the pane looked), the pane shows the same
warning.

Once acknowledged, the change applies only to an `idle` session: the engine writes the attachment, closes the
session's runtime and resumes it by id with the new servers (`SessionService.reconfigure`); the conversation is kept.
While a turn runs or an approval waits, it answers `invalid_state` ("change its MCP servers when it is idle") and
changes nothing. If reopening fails, the attachment is put back. Ended, failed and resumable sessions change without a
warning: they have no runtime open, and a resumed session starts with whatever is attached then.

## Secrets

A secret the user types (a preset's token parameter, or a header or variable marked secret in the editor) is written
by the app straight to its Keychain broker (`SecretBroker.store`), under a reference such as
`keychain:github/github.com/pat` or `keychain:mcp/<server>/<field>`. Only the reference reaches the engine and the
file: as `{secretRef}`, or as a `${secret:…}` placeholder after a prefix such as `Bearer `. The engine reads the value
through `secrets.get` when it checks health or starts a session (M-03), and remembers it in the redactor so it never
appears in a log line or event.

**A saved secret is never rendered back into a field.** `McpBackend` has no call that reads a secret. The editor is
built from the server's definition, which holds only references: a saved secret's field starts empty with "Saved —
type to replace" and a key mark; typing replaces it under the same reference (and rechecks the server), leaving it
empty keeps it. Tests: `SecretFieldTests` (package) and `McpUITests.testASavedSecretIsNeverRenderedBackIntoAField`,
which also searches the whole window for the token.

Health checks run in the background, with no request to answer them. `SocketListener.requestAnyClient` asks each
connected client in turn, newest first, until one answers with a value; a client without the method (the CLI) or
without the secret is passed over. When no app is connected a `keychain:` server is `needs_auth`; when a client
completes `engine.hello` every `needs_auth` server is checked again.

## Signing in

`mcp.login` runs M-03's flow (discovery, dynamic client registration, PKCE, loopback redirect), opening the
authorization page with `/usr/bin/open`. It waits for the user, so the app gives it five minutes. A server with a grant
gets `Authorization: Bearer <token>` added on each start, in health checks and sessions alike, unless its definition
has its own Authorization header. Grants are kept in memory only (M-03's limit), so a restarted engine asks again.

## Health and the token-cost column

The monitor (M-06) is synced with every global server and each workspace's own (an id two workspaces both define is
checked as the first one read), at engine start, after every add, edit, remove or import made through the engine,
and when a client connects. The token cost of a server is M-04's estimate over the tool list from its last good check:
what its tool definitions add to every prompt of a session it is attached to. It shows "—" until the server has been
checked.

## Testing

- `server/tests/mcp/manage-composition.test.ts`: over the production composition with a stub MCP server
  (`testkit`'s `startStubMcpServer`, which needs a bearer token) and `redirectingFetch`, which sends the GitHub
  preset's `https://api.githubcopilot.com` to the stub. Adding the preset makes it healthy with the PAT read from the
  client; the file holds only the reference; a workspace's server is copied into a new session, whose runtime gets the
  substituted header; a live session's change is refused until acknowledged and then reopens the runtime.
- `core/tests/mcp-manage/manager.test.ts`: entries round-trip, inline secrets are refused without echo, busy
  sessions refuse, runtime servers leave out one whose secret is missing.
- `app/Packages/McpServers/Tests`: the secret fields and the session pane's warning.
- `McpUITests` over `fake-picad`'s `mcp` scenario, which starts the stub and asks for `pica-ui-test-token`. Pica keeps
  secrets in memory under UI tests (`PICA_SECRETS=memory`): a rebuilt, ad-hoc signed Pica would be asked for Keychain
  access by every new build.

## Limits

- Repo-scope servers (a repo's `.pica/mcp.jsonc`, `.vscode/mcp.json`, `.mcp.json`) are not listed, checked or
  attachable: a session's repos are not consulted yet. They are imported and edited in the repo.
- File changes made outside Pica are seen on the next listing; health follows them only after an engine-side change
  or a client connecting. There is no file watching.
- OAuth grants are in memory only. M-02's GitHub Enterprise endpoint is still unknown, and M-07 still does not read
  Codex's TOML file; pasting a Codex server converted to JSON works.
- The `open_settings` fix targets M-03 names (`mcp/<id>/secrets`) are not routed to the window yet.
- Agent-scoped attachments exist in the protocol and the engine; the app attaches to the whole session only.
