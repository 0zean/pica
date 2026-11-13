# MCP secrets and OAuth

How the engine turns the secret references in an MCP server definition ([secret-references.md](secret-references.md)) into values, signs in to OAuth-protected servers, and keeps both out of everything it records (M-03). Code: `engine/packages/core/src/mcp-auth/` (pure), `engine/packages/adapters/src/secrets/` and `engine/packages/adapters/src/mcp-oauth/`.

## Resolving references

`resolveMcpServerSecrets(definition, sources, redactor)` reads each distinct reference in `env`, `headers`, and `args` once, in definition order, and returns an `McpServerLaunch` with the values substituted. The launch holds secrets: it goes to the runtime and nowhere else.

| Provider | Source | Adapter |
|---|---|---|
| `keychain` | The app's Keychain broker, through the engine → client `secrets.get` request with the reference text as `secretRef` (`keychain:github/pat`). | `createBrokerSecretSource(call)`; the server's `Connection.request("secrets.get", …)` is the call. |
| `env` | The engine's own environment. | `createEnvSecretSource(env)` |

A client answer of `secret_unresolved` or `not_found`, or an empty value, means the secret is not set. Any other failure (client gone, timeout, malformed reply) is a read failure.

## Errors

All are `secret_unresolved` unless noted; messages name the server and references, never values.

| Case | `fix` |
|---|---|
| A `keychain` reference is not set | `open_settings`, target `mcp/<serverId>/secrets`: the server's secrets pane, where the app asks for the value and stores it in the Keychain. |
| An `env` reference is not set | `open_settings`, target `mcp/<serverId>/environment`: the server's environment pane, which explains how to set the variable for `picad`. |
| The broker could not answer | `retry` |
| A malformed reference reached the engine (`config_invalid`) | none; M-01 validation normally rejects it first. |

When several references are missing, `details.secretRefs` lists all of them, `details.secretRef` is the first, and the fix opens the pane for the first.

## OAuth sign-in (`mcp.login`)

For `http` and `sse` servers, `loginMcpServer` runs the authorization code flow with PKCE (S256) as the MCP authorization spec describes:

1. Discover the authorization server: RFC 9728 protected resource metadata at the server URL, then RFC 8414 metadata (or OpenID configuration) for the first `authorization_servers` entry. A server with no resource metadata is treated as its own authorization server.
2. Listen for the redirect on `http://127.0.0.1:<ephemeral port>/callback` (RFC 8252 loopback).
3. Register a public client with RFC 7591 dynamic registration (`token_endpoint_auth_method: none`). Servers without a registration endpoint fail with `config_invalid`; pre-registered client ids are not supported yet.
4. Open the authorization page with `state`, `code_challenge`, and the RFC 8707 `resource` parameter; the engine opens the user's browser itself, since it runs on the same Mac.
5. Check `state`, exchange the code, store the grant, and report the server authorized.

## Tokens and `needs_auth`

`createMcpTokenManager` hands out the access token for a server and refreshes it 60 seconds before its stated expiry, or at once when the caller passes `forceRefresh` after the MCP server answered 401. Concurrent callers share one refresh.

When refreshing fails, the manager reports the server through `McpAuthStatusSink.needsAuth` (which becomes `mcp.statusChanged` with state `needs_auth`) and returns `auth_required` with fix `sign_in`, target the server id, which the client answers with `mcp.login`. It never touches sessions: a session using the server keeps running, its other tools keep working, and the server's tools work again after sign-in. A grant the authorization server rejected is forgotten; after an unreachable or failing authorization server the grant is kept, so the next call retries the refresh.

Grants are held in memory (`createMemoryMcpGrantStore`), so OAuth servers are signed in again after the engine restarts. Persisting them needs an engine → client request that writes to the Keychain, which the protocol does not have yet; tokens are never written to the database.

## Keeping secrets out of records

Every secret value the engine reads or receives (resolved references, access and refresh tokens, authorization codes, PKCE verifiers) is given to an `McpSecretRedactor`, which replaces it with `[redacted]` in its raw, JSON-escaped, and percent-encoded forms. The engine passes through it:

- log lines (`createRedactingLogger`),
- session events, before they are stored or delivered (`createRedactingEventLog`),
- error messages and `needs_auth` reasons.

OAuth adapter failures carry status codes and registered OAuth error codes only, never response bodies. Values shorter than 4 characters are not redacted, since that would erase ordinary text. Secrets the engine never saw, such as a token a tool prints on its own, are H-03's pattern-based scrubber's job.
