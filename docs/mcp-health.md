# MCP health and diagnostics

M-06 keeps one connection open to every configured MCP server and reports how it is doing. Code: `engine/packages/core/src/mcp-health/` (pure monitor and ports), `engine/packages/adapters/src/mcp-client/` (stdio and Streamable HTTP clients), `engine/packages/server/src/mcp-handlers.ts` (RPC).

## Status

`McpServerStatus` (protocol `dto/mcp.ts`):

| State | Meaning |
|---|---|
| `connecting` | Starting, or waiting for a restart after a crash (`restarts` > 0, `lastError` says why). |
| `healthy` | `initialize` and every page of `tools/list` answered within `slowMs`. |
| `degraded` | Answered, but slower than `slowMs`, or `tools/list` failed on a live connection (protocol error or timeout). |
| `needs_auth` | The server refused our credentials (HTTP 401/403) or a secret reference is unresolved. Not retried until `mcp.restart` (after `mcp.login` or a settings change) or a config change. |
| `failed` | A stdio server crashed more than `restart.maxAttempts` times, or an HTTP server is unreachable (checked again every `checkIntervalMs`). |
| `stopped` | Removed from the configuration. |

`tools`, `toolDefinitionTokens` (M-04's estimate) and `latencyMs` come from the last `tools/list`. `lastError` never contains a secret value: secret-bearing messages pass through M-03's redactor, HTTP failures name the origin and status only, and a stdio server's stderr is dropped.

## Restarts

Only stdio servers are restarted. After the n-th crash in a row the monitor waits `min(maxDelayMs, initialDelayMs × multiplierⁿ⁻¹)` and starts the process again; after `maxAttempts` restarts it gives up (`failed`). A connection that stayed up for `stableAfterMs` resets the count. `mcp.restart` also resets it.

| Option | Default |
|---|---|
| `slowMs` | 2 000 |
| `timeoutMs` (connect, `tools/list`) | 15 000 |
| `checkIntervalMs` | 60 000 |
| `restart.maxAttempts` | 5 |
| `restart.initialDelayMs` / `maxDelayMs` / `multiplier` | 1 000 / 30 000 / 2 |
| `restart.stableAfterMs` | 60 000 |

All timing goes through the injected `McpHealthClock`, so tests drive backoff and timeouts without waiting.

## RPC

- `mcp.status {id}` → `{status}`; `not_found` for an unknown server.
- `mcp.statusList {}` → `{statuses}` sorted by server id.
- `mcp.restart {id}` → reconnects now with a fresh restart count.
- `mcp.statusChanged {status}` notification on every change.

`startEngine({ mcpHealth })` registers these when given a monitor. Building the monitor (registry from M-01, secret sources from M-03, `createMcpLaunchConnector`) and calling `sync` on config changes belongs to the composition root once the registry is wired in.
