# MCP server configuration

M-01 builds the MCP registry: every server definition a session can see, merged from Pica's own files and from files other tools already keep. Core logic is in `engine/packages/core/src/mcp/`, file reading in `engine/packages/adapters/src/config/mcp-registry-loader.ts`.

## Pica's own file: `mcp.jsonc`

JSONC (comments and trailing commas allowed), beside `config.jsonc` at each level:

| Scope | Location |
|---|---|
| global | `~/Library/Application Support/Pica/mcp.jsonc` |
| workspace | stored with the workspace in the engine database (passed to the loader as a value) |
| repo | `<repo>/.pica/mcp.jsonc` |

```jsonc
{
  "servers": {
    "github": {
      "name": "GitHub",                       // optional; defaults to the id
      "type": "http",                         // "stdio" | "http" | "sse"
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${secret:keychain:github/pat}" },
      "tools": ["get_issue"]                  // optional; absent means every tool
    },
    "scripts": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "env": { "API_TOKEN": { "secretRef": "env:SCRIPTS_TOKEN" } },
      "cwd": "tools/mcp"
    }
  }
}
```

The key is the server id, `[A-Za-z0-9][A-Za-z0-9._-]*`, which is also the `server` in MCP tool names `server/tool`. Unknown keys are errors. Secrets are written as references; see [secret-references.md](secret-references.md).

MCP servers live in their own file rather than in `config.jsonc` because `config.jsonc` merges leaf by leaf, and a server definition must be replaced whole: a repo that redefines `github` with a new URL must not inherit the global definition's headers.

## Imported files

| Format | File | Scope |
|---|---|---|
| `copilot-cli` | `~/.copilot/mcp-config.json` | global |
| `mcp-json` | `<repo>/.mcp.json` | repo |
| `vscode` | `<repo>/.vscode/mcp.json` | repo |

Each is read in place on every load; Pica never writes to it. Conversion:

- `type` is optional when `command` (stdio) or `url` (http) makes it clear. The Copilot CLI's `local` is `stdio`.
- Copilot CLI `tools: ["*"]` means every tool; any other list is the allowlist.
- A server name that is not a valid id becomes one (runs of other characters become `-`), and the original name is kept as `name`. Two names that map to one id are an error.
- VS Code `${workspaceFolder}` and `${userHome}` become the repo root and home directory. Other VS Code variables (for example `${command:…}`) are errors.
- Fields Pica has no equivalent for (VS Code `envFile`, `dev`; `.mcp.json` `timeout`; unknown top-level keys) are skipped and reported as **import notes** with their key path, so the app can show what was left out.

## Precedence

Lowest to highest, following config layers (PLAN.md §4.6):

1. global: Copilot CLI file, then global `mcp.jsonc`
2. workspace
3. repo: `.mcp.json`, then `.vscode/mcp.json`, then `.pica/mcp.jsonc`

A server id in a higher source replaces the lower definition whole. `ResolvedMcpServer.shadowed` lists the definitions it replaced, highest first, so the app can explain why a server looks the way it does. The resolved `McpServerDef.scope` is the scope of the winning source.

Any invalid source fails the whole load with a `ConfigError` naming the file, line, column, and key path, as `config.jsonc` errors do. A missing file is an absent source.

Managed locking does not apply here; the managed MCP allowlist is M-05.
