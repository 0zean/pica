# Copilot adapter and replay transcripts (E-09)

The Copilot adapter (`engine/packages/adapters/src/copilot/`) implements the `AgentRuntime` port over `@github/copilot-sdk` **1.0.28** (pinned exactly; it bundles Copilot CLI runtime 1.0.110). The replay server (`engine/packages/testkit/src/copilot/`) answers the SDK's JSON-RPC over loopback TCP from transcripts in `engine/packages/testkit/fixtures/copilot/`, so the adapter is tested through the real SDK client without a Copilot login or network access.

## Provenance: every transcript is inferred

S-01 (live auth spike) has not run, so **no transcript is recorded**. Each one has `"provenance": "inferred"`. Its shapes come from the SDK 1.0.28 package: `dist/generated/rpc.d.ts`, `dist/generated/session-events.d.ts`, `dist/types.d.ts`, and the request and handler code in `dist/client.js` and `dist/session.js`. When S-01 records real sessions, replace these files with recordings and set `"provenance": "recorded"`.

### Taken from the SDK source (what the client sends or demands)

These are what the SDK code itself sends, reads, or requires, so a real runtime must match them:

- Framing: JSON-RPC 2.0 with `Content-Length` headers (`vscode-jsonrpc` stream reader and writer).
- Handshake: the `connect` request, whose result must carry `protocolVersion` in 3..3.
- Request names and params: `auth.getStatus`, `models.list` (result `{ models }`), `models.listTokenPriceUnits` (result `{ units }`; from the transcript's optional `tokenPriceUnits`, or `ai_credits` for every model with `billing.tokenPrices` when it is absent), `account.getQuota`, `session.create` (client-chosen `sessionId`, `hooks: true` when hooks are registered, `requestPermission: true`), `session.resume`, `session.send` (result `{ messageId }`), `session.abort`, `session.detach` (result `{ success }`), `session.permissions.handlePendingPermissionRequest` (`{ requestId, result: { kind: "approve-once" | "reject" } }`).
- Server-to-client traffic: `session.event` notifications `{ sessionId, event }`, and `hooks.invoke` requests `{ sessionId, hookType, input }` answered with `{ output }`. Hook inputs use epoch-ms `timestamp` and `cwd`.
- Event envelope `{ id, timestamp, parentId, type, data, agentId?, ephemeral? }`, and the `data` fields of each event type.

### Inferred, to be confirmed by S-01 to S-03

| Behaviour | Assumption in the transcripts and adapter | Settled by |
|---|---|---|
| Hook ↔ tool call correlation | `tool.execution_start` comes before `preToolUse`. Hook inputs have no `toolCallId` (the public `BaseHookInput` type has none), so the adapter matches each hook to the oldest started call of the same tool. It uses a `toolCallId` on the input if the runtime sends one. | S-02 |
| Event order within a tool call | start → `preToolUse` → optional `permission.requested`/`completed` → (sub-agent frames) → `postToolUse` → `tool.execution_complete`. `postToolUse` does not run for denied, rejected or failed calls. | S-02 |
| Denied tool result | `tool.execution_complete` with `success: false` and `error.message` containing the hook's reason. | S-02 |
| Modified result | The event shows the original result. The adapter replaces it with the post hook's result, so Pica's event matches what the model saw. | S-02 |
| `ask` | Produces `permission.requested` with a `kind: "hook"` request (`toolCallId`, `toolName`, `toolArgs`, `hookMessage`). | S-02 |
| Sub-agent identity | `subagent.*` events identify the sub-agent by the `task` call's `toolCallId`. The adapter uses that id as `agentId`, and events from inside the sub-agent carry the same value in their envelope `agentId`. | S-02, S-03 |
| Cached tokens | `assistant.usage.cacheReadTokens` maps to `cachedInputTokens`, reported separately from `inputTokens`. | S-03 |
| Token prices | `billing.tokenPrices` is per `batchSize` tokens and in AI Credits. The adapter converts it to credits per million tokens and reads a missing `batchSize` as one million. | S-01 |
| Quota | `account.getQuota` still reports request counts per quota type. The adapter reads `ai_credits`, then `premium_interactions`, then the first key alphabetically. | S-01 |
| Auth missing | `auth.getStatus` returns `isAuthenticated: false` with a `statusMessage`, and account calls fail with `data.errorType: "authentication"` / 401. | S-01 |
| Quota exhausted | The turn emits `session.error` with `errorType: "quota"`, `errorCode: "quota_exceeded"`, 402. | S-01 |
| Model unavailable | A listed model with `policy.state: "disabled"` is refused by the adapter before `session.create`. The runtime refuses a model the account lost with a JSON-RPC error carrying `errorCode: "model_not_supported"` or a "model … not available" message. The adapter also checks `options.model` against `models.list` itself, because the runtime may fall back to another model silently. | S-01 |
| Session not found | `session.resume` with an unknown id fails with the message `Session not found: <id>`. | S-01 |
| Busy session | The runtime would queue a second `session.send`; the adapter refuses it with `runtime.session_busy`, as the port requires. | — |

## Error mapping

`classifyError` in `errors.ts` maps `{ errorType, errorCode, statusCode, message }`, taken from `session.error` data or a JSON-RPC error's `data`, to the stable `RuntimeErrorCode`s:

- `authentication` or `authorization`, or 401 → `runtime.auth_missing`
- `quota`, or 402 → `runtime.quota_exhausted`
- a model error code or a "model … not available / unsupported / disabled" message → `runtime.model_unavailable`
- "session not found" → `runtime.session_not_found`
- anything else → `runtime.failed`

`protocolErrorCode` in `engine/packages/core/src/runtime/errors.ts` maps each of these to a client-facing `ErrorCode` from `engine/packages/protocol/src/common.ts`. For example, `runtime.auth_missing` becomes `auth_required`, and the quota and model codes keep their names. It is meant for the code that reports runtime failures to clients (E-08).

## Usage totals

`session.usage()` totals the `assistant.usage` events this adapter instance has seen. It does not call `session.usage.getMetrics`, whose result shape is not yet confirmed, so usage from before a resume is not included.
