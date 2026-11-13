# Secret references

MCP server definitions never hold secrets. They hold **references** that name where a secret lives; the engine resolves each reference when it starts a server (M-03). This page defines the syntax M-01 validates and M-03 resolves.

## Syntax

A reference is `<provider>:<name>`.

| Provider | Name grammar | Resolved by |
|---|---|---|
| `keychain` | `[A-Za-z0-9][A-Za-z0-9._/-]*`, for example `github/pat` | The app, through the `secrets.*` engine → client requests, from the macOS Keychain. The app prompts and stores the value the first time. |
| `env` | `[A-Za-z_][A-Za-z0-9_]*`, for example `GITHUB_TOKEN` | The engine, from its own environment. |

Any other provider, or a name outside the grammar, is a validation error (`config.invalid`, "malformed secret reference").

A reference is written in a file in one of two forms:

- **Inside a string:** `${secret:<provider>:<name>}`. A string may mix literal text with references, which is how a header carries a scheme: `"Authorization": "Bearer ${secret:keychain:github/pat}"`.
- **As a whole value:** `{ "secretRef": "<provider>:<name>" }`.

The two forms are equivalent when the string is a single reference: `"${secret:env:DD_API_KEY}"` and `{ "secretRef": "env:DD_API_KEY" }` both become the protocol value `{ "secretRef": "env:DD_API_KEY" }` in `McpServerDef`. Strings that mix text and references reach the protocol unchanged, and M-03 substitutes each placeholder.

References are allowed only in `env` values, `headers` values, and `args`. Anywhere else (`command`, `cwd`, `url`, `name`, `tools`) is a validation error.

## Inline secrets are rejected

A definition that appears to contain a secret written out in full is rejected with `config.inline_secret`. The message names the file, line, column, and key path, says to use a reference instead, and links here; it never repeats the value. The checks, in `engine/packages/core/src/mcp/inline-secrets.ts`:

1. **Sensitive names.** An `env` variable, header, URL query parameter, or command-line flag (`--token=…`, or `--token …`) whose name contains one of the words `token secret password passwd pwd apikey key pat credential(s) authorization auth cookie` (split on `_`, `-`, and camel case) has a literal value. Names ending in `path file dir url uri id name mode type host site` are not sensitive, so `PRIVATE_KEY_PATH` and `OAUTH_CLIENT_ID` pass. An empty value passes, and so does a value whose only literal text, once references are removed, is an auth scheme (`Bearer`, `Basic`, `token`, `apikey`, `api-key`).
2. **Known token shapes** anywhere in `command`, `cwd`, `args`, `env`, `headers`, or `url`: GitHub (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), GitLab (`glpat-`), `sk-` API keys, Slack (`xox?-`), AWS access key ids (`AKIA…`), ClickUp (`pk_<n>_…`), and PEM private keys.
3. **Credentials in a URL:** a password in the user-info part (`https://user:pw@host`).

These rules catch the common cases; they are not a guarantee. Redaction of anything that slips through is H-03.

## Imported files

Importers translate other tools' variable syntax into references, so imported definitions pass these checks when the source file did not inline secrets either:

| Source | Variable | Becomes |
|---|---|---|
| `.vscode/mcp.json` | `${env:NAME}` | `${secret:env:NAME}` |
| `.vscode/mcp.json` | `${input:id}` | `${secret:keychain:id}`: the app asks once and keeps the answer in the Keychain, as VS Code's prompt would |
| `.mcp.json`, Copilot CLI `mcp-config.json` | `${NAME}`, `${NAME:-default}` | `${secret:env:NAME}`; a default is dropped and reported as an import note |

See [mcp-configuration.md](mcp-configuration.md) for the file formats and precedence.
