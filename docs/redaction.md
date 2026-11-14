# Redaction

How the engine keeps secrets out of logs, events and diagnostics bundles (H-03). Code: `engine/packages/core/src/redaction/` (pure). It complements M-03 ([mcp-secrets.md](mcp-secrets.md)), which redacts the exact values the engine resolved; the scrubber here catches secrets the engine never handled, such as a token a user pastes or a tool prints.

## Where it runs

- **Logs.** `startEngine` wraps its logger with `createRedactingLogger(log, createSecretScrubber())`, so every line `picad` writes is scrubbed.
- **Events.** The session event log is wrapped with `createRedactingEventLog`, so every string in an event payload (keys included) is scrubbed before it is stored or delivered.
- **Diagnostics.** `buildDiagnosticsBundle` scrubs everything it copies and leaves out content fields (below).

`createSecretScrubber(known?)` returns an `McpSecretRedactor`: it applies M-03's exact-value redactor first, when given, then the patterns. Pass the M-03 redactor in once MCP launch is wired, so one redactor covers both.

## Formats

Every match becomes `[redacted]`. Where a header or setting name precedes the value, the name is kept (`DD_API_KEY=[redacted]`, `Authorization: Bearer [redacted]`).

| Pattern | Matches |
|---|---|
| `pem-private-key` | `-----BEGIN … PRIVATE KEY-----` through its END line, or to the end of the text when a preview cut it off |
| `github-token` | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` followed by 20 or more alphanumerics |
| `github-fine-grained-pat` | `github_pat_…` |
| `copilot-token` | The Copilot API token, `tid=…;exp=…;…` |
| `clickup-token` | `pk_<digits>_<alphanumerics>` |
| `jwt` | `eyJ….eyJ….…` |
| `aws-access-key-id` | `AKIA`, `ASIA`, `ABIA`, `ACCA` followed by 16 characters |
| `authorization-header` | The value of an `Authorization` header or setting, after an optional `Bearer`/`Basic`/`token` scheme |
| `bearer-token` | `Bearer <16 or more token characters>` anywhere |
| `url-credentials` | The password in `scheme://user:password@host` (Snowflake, Postgres, git remotes) |
| `quoted-assignment`, `assignment` | A value assigned to a sensitive name: `name=value`, `name: value`, `"name": "value"`, `--name value` |

A sensitive name is one whose last segment (split on `_`, `-`, `.`) is `key`, `secret`, `token`, `password`, `passwd`, `pwd`, `pat`, `credential(s)`, or one of the joined forms `apikey`, `appkey`, `accesskey`, `secretkey`, `authtoken`, `accesstoken`, `refreshtoken`, in any case. That covers `DD_API_KEY`, `DD-APPLICATION-KEY`, `SNOWFLAKE_PAT`, `SNOWFLAKE_PASSWORD`, `CLICKUP_API_TOKEN`, `aws_secret_access_key`, `client_secret` and `apiKey`. Datadog keys and Snowflake PATs have no prefix of their own, so they are caught by the name they are assigned to; a bare 32- or 40-character hex string is left alone because commit SHAs look the same.

In structured values (`scrubSecretsDeep`), a string under a sensitive key is redacted whole.

## What is left alone

- References: `${secret:…}`, `$VAR`, and values under a `secretRef` key name a secret rather than hold one.
- Literals `true`, `false`, `null`, `undefined`, `none` assigned to a sensitive name.
- Names that only contain a sensitive word: `max_tokens`, `tokenLimit`, `monkey`.
- A call such as `token = getToken()`.
- Prose such as "the token expired" or "Bearer tokens are sent in the header".

The scrubber errs toward redacting: an ordinary value assigned to a sensitive name (`key: value` in YAML) is redacted too.

## Diagnostics bundle

`buildDiagnosticsBundle({ generatedAt, environment, config, sessions, logs })` returns a JSON value with `format: "pica-diagnostics"` and `version: 1`. Event fields that can carry file contents — `user.message.text`, `assistant.delta.text`, `assistant.message.text`, `tool.started.arguments`, `tool.completed.resultPreview`, `tool.failed.error`, `runtime.unknown.raw` — are replaced by `{ omitted: "content", chars }`, plus `keys` (scrubbed) for tool arguments. Every other field, the session summaries, the config, the environment and the log lines are scrubbed. H-04 owns collecting the inputs and writing the bundle to disk.

## Tests

- `engine/packages/core/tests/redaction/token-corpus.test.ts` runs the corpus in `fixtures/token-corpus.json`: each entry must lose every listed secret, every `preserve` line must come out unchanged.
- `engine/packages/core/tests/redaction/diagnostics-bundle.test.ts` builds the bundle for a recorded fixture session that reads, quotes and edits `fixtures/session-files/billing.ts.txt` and echoes corpus secrets; the bundle must contain neither.

All values in the fixtures are fake. When adding a format, add entries to the corpus, including near misses under `preserve`.
