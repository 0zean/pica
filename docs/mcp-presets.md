# MCP presets

Pica works with no MCP server (D-18). A preset is a parameterized definition for a server some users already run; listing one enables nothing, and a session carries a server only after the user adds it and attaches it (M-04). Code: `engine/packages/core/src/mcp-presets/`.

## Presets

Endpoints and auth are the ones in PLAN.md §2.2. Every secret parameter takes a secret reference (`keychain:<name>`, `env:<NAME>`, or `${secret:…}`; see [secret-references.md](secret-references.md)), never the secret.

| Preset | Parameters | Renders |
|---|---|---|
| `github` | `auth` = `copilot` (default) or `pat`; `patSecretRef` (with `pat`, default `keychain:github/<host>/pat`); `url` | `https://api.githubcopilot.com/mcp/`. With `copilot` there is no header: the runtime attaches the Copilot sign-in. With `pat`, `Authorization: Bearer ${secret:…}`. The preset follows the configured GitHub host (D-20): on GHE.com and GHES the Copilot MCP endpoint is not recorded, so `url` is required there. |
| `datadog` | `site` (default `datadoghq.com`); `auth` = `oauth` (default) or `apiKey`; `apiKeySecretRef` and `applicationKeySecretRef` (with `apiKey`) | `https://mcp.<site>/api/unstable/mcp-server/mcp`. With `oauth` there is no header; with `apiKey`, `DD-API-KEY` and `DD-APPLICATION-KEY` as secret references. |
| `clickup` | none | `https://mcp.clickup.com/mcp`, OAuth. |
| `snowflake` | `accountUrl`, `database`, `schema`, `server` (the `CREATE MCP SERVER` name), `patSecretRef` | `<accountUrl>/api/v2/databases/<database>/schemas/<schema>/mcp-servers/<server>` with `Authorization: Bearer ${secret:…}`. |

## Validation

A missing, malformed, unknown, or inapplicable parameter fails with an issue naming it (`{ parameter, message }`); all issues are reported at once. Messages never repeat a value, since a mistyped reference may be the secret itself. The rendered entry then goes through the same checks as a hand-written one (M-01), including the inline-secret rule.

## API

- Core: `listMcpPresets(context)`, `renderMcpPreset(id, parameters, { serverId, scope }, context)` → `McpServerDef`, `renderMcpPresetEntry(...)` → the `mcp.jsonc` entry, and `renderEnabledMcpPresets(selections, context)`, which renders only selections with `enabled: true`.
- RPC (for A-13): `mcp.presets` lists presets with their parameters; `mcp.renderPreset` returns the definition, or `invalid_params` with `details.issues`, or `not_found` for an unknown preset. Neither adds nor attaches anything; adding is `mcp.add`.
