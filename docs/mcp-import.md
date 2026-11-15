# Importing MCP servers from other agent platforms

M-07 lets users bring the MCP servers they already run in other agent platforms (D-18). Pica does not name or
suggest servers; it reads the files those platforms keep, lists what it finds, and copies only what the user picks
into Pica's own [`mcp.jsonc`](mcp-configuration.md).

Core logic (pure) is in `engine/packages/core/src/mcp-import/` and the formats in
`engine/packages/core/src/mcp/import/formats.ts`. File discovery and writing are in
`engine/packages/adapters/src/config/mcp-import-*.ts`. The RPC handlers are in
`engine/packages/server/src/mcp-import-handlers.ts`.

## Where Pica looks (macOS)

| Platform | File | Shape |
|---|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `mcpServers`: `command`, `args`, `env` |
| Claude Code | `~/.claude.json` | `mcpServers` (user) and `projects.<dir>.mcpServers` (local); `type`, `command`, `args`, `env`, `url`, `headers` |
| Cursor | `~/.cursor/mcp.json`, `<repo>/.cursor/mcp.json` | `mcpServers`: `command`, `args`, `env`, or `url`, `headers` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers`; a remote server's URL is `serverUrl` |
| VS Code | `~/Library/Application Support/Code/User/mcp.json` (and `Code - Insiders`), `<repo>/.vscode/mcp.json` | `servers` and `inputs` |
| Gemini CLI | `~/.gemini/settings.json`, `<repo>/.gemini/settings.json` | `mcpServers`; `httpUrl` is streamable HTTP, `url` is SSE, `includeTools` is the allowlist |
| Copilot CLI | `~/.copilot/mcp-config.json` | `mcpServers`; `local` is stdio |
| `.mcp.json` | `<repo>/.mcp.json` | `mcpServers` |

Each format's comment in `formats.ts` names the documentation it follows. Project files are read only when the
request names a repo. **Codex** (`~/.codex/config.toml`, `[mcp_servers.*]`) is not read yet: it is TOML and the
engine has no TOML parser (PLAN.md M-07).

A file that does not exist yields nothing. One that exists but cannot be read or parsed is listed with no candidates
and a note saying why; it is never an error.

## Conversion

Conversion follows [mcp-configuration.md](mcp-configuration.md#imported-files), plus:

- Variables become secret references in Pica's syntax: `${VAR}` and `${VAR:-default}` (Claude Code, Copilot CLI,
  `.mcp.json`), `${env:VAR}` (VS Code, Cursor, Windsurf), `$VAR` and `${VAR}` (Gemini CLI) become
  `${secret:env:VAR}`; VS Code `${input:id}` becomes `${secret:keychain:id}`. Cursor's `${userHome}`,
  `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}` and `${/}` are substituted. Claude Desktop
  expands nothing. Any other variable (Windsurf `${file:…}`, for example) makes the entry not importable.
- Fields Pica has no equivalent for (`envFile`, `disabled`, `disabledTools`, `excludeTools`, `timeout`, `trust`, …)
  are dropped, each with a **note** naming its key path. Unrelated keys in settings files (Claude Code, Claude Desktop,
  Gemini CLI) get no note.
- A candidate with **issues** cannot be imported; each issue names its key path.

## Pasted snippets

`mcp.importCandidates {snippet}` previews and `mcp.import {snippet}` imports a pasted snippet in any of these shapes:

- `{ "mcpServers": { "<name>": { … } } }`
- `{ "servers": { "<name>": { … } }, "inputs": [ … ] }` (VS Code)
- `{ "<name>": { … } }`, a bare map
- `{ "command": …, … }` or `{ "url": …, … }`, one entry, with `snippet.name` or a `name` field
- `"<name>": { … }`, a member copied without the outer braces

Fields are read under every platform's names (`serverUrl`, `httpUrl`) and every platform's variables are understood.
The snippet is JSON (no comments). A malformed snippet fails with `invalid_params`, `details.reason =
mcp_import.malformed_snippet`, and `details.issues[].keyPath` naming the problem, relative to the text pasted ("" is
the snippet itself); the message starts with the key path.

## Importing

`mcp.import {scope, candidates | snippet}` copies the chosen entries into `mcp.jsonc` at `scope`:

| Scope | File |
|---|---|
| global | `~/Library/Application Support/Pica/mcp.jsonc` |
| workspace | `~/Library/Application Support/Pica/workspaces/<workspaceId>/mcp.jsonc` |
| repo | `<repo>/.pica/mcp.jsonc` |

- **Inline secrets move to the Keychain.** Each value the inline-secret rules flag ([secret-references.md](secret-references.md))
  in `env`, `headers` or `args` is sent to the app with `secrets.set {secretRef, value}` and replaced by
  `${secret:keychain:mcp/<id>/<field>}` (`Bearer <token>` keeps its scheme: `Bearer ${secret:keychain:…}`). All
  secrets are stored before the file is written; if one cannot be stored, nothing is written. A secret in `url`,
  `command` or `cwd` cannot be a reference, so that entry is not importable.
- **Each entry records its origin** in `importedFrom`: `{ platform, source, name, project? }`, with the home directory
  written as `~` so a repo file carries no personal path. A pasted entry has no `source`.
- A chosen id already in the target file is `already_exists` (`details.reason = mcp_import.conflict`); pass `id` in the
  selection to import under another name.
- **Nothing is attached.** Importing writes `mcp.jsonc` and the Keychain only. The server is defined at that scope and
  appears in the registry; a session gets it only through `mcp.attach` or an agent's tool list (M-04).
- `candidateId` is opaque. The engine reads the platform files again on `mcp.import`; pass the same `repoId` the
  candidates were listed with. A candidate that has gone is `not_found` (`mcp_import.unknown_candidate`).

The engine's existing M-01 live import of `.vscode/mcp.json`, `.mcp.json` and the Copilot CLI file is unchanged;
importing one of those servers makes a Pica copy that wins over the live one at the same id.
