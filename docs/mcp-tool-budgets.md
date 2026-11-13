# MCP scoping and tool budgets

M-04 decides which MCP servers each part of a session can see, and estimates what their tool definitions cost in context. Code: `engine/packages/core/src/mcp-attach/` (pure). It takes server definitions from M-01's registry (`resolveMcpServers`) and agent definitions from C-02.

## Attachment

A server reaches a session only through an attachment (`McpAttachment`):

| Target | Effect |
|---|---|
| `{ kind: "session" }` | The server goes in the session's top-level `mcpServers`, seen by the main agent. |
| `{ kind: "agent", agent }` | The server goes only in that custom agent's `mcpServers`. No other agent and not the main agent gets it. |

An agent whose `tools` list (C-02) names `server/tool` or `server/*` attaches that server to itself: `agentMcpAttachments(agents)` turns those entries into attachments. Attachments given by the session (UI or workspace settings) are passed alongside.

`attachMcpServers(definitions, agentNames, attachments)` returns an `McpAttachmentPlan`, and `mcpSessionConfig(plan)` turns the plan into the runtime's per-session and per-agent `mcpServers` entries. A target with nothing attached gets no `mcpServers` key, so a session with no attachments carries no MCP tool definitions at all. Secret references are left unresolved for M-03.

## Tool allowlists

Each attachment may name tools; `null` means "whatever the server allows".

- The server's own allowlist (`tools` in `mcp.jsonc`, `McpServerDef.toolAllowlist`) is the ceiling. An attachment naming a tool outside it is rejected (`mcp_attach.tool_not_allowed`).
- Effective tools = the attachment's list if given, else the server's allowlist, else every tool (`["*"]` in the runtime config).
- Attaching one server twice to the same target joins the lists; `null` on either side means every tool.
- An empty list is rejected (`mcp_attach.empty_allowlist`); detach the server instead.

Other errors: `mcp_attach.unknown_server`, `mcp_attach.unknown_agent`. All problems are reported together under `mcp_attach.invalid`.

## Token estimation

The estimate is for showing cost before attaching (PLAN.md §11, "MCP tool definitions bloat the context") and for `McpServerStatus.toolDefinitionTokens` (M-06). It needs no tokenizer and no network, so it gives the same number everywhere.

For each tool a target can see (the server's `tools/list` result, cut to the effective allowlist):

1. Build the payload `{ name: "<serverId>/<toolName>", description, input_schema }`. `description` is left out when the server gives none; `input_schema` is the tool's `inputSchema` unchanged.
2. Serialize it as canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, non-ASCII characters not escaped.
3. `tokens = ceil(utf8Bytes / 4) + 4`. Four bytes per token is the usual rule of thumb for English and JSON with BPE tokenizers; the extra 4 per tool stands for the framing the runtime adds around each definition.

A server's estimate is the sum over its visible tools; a target's is the sum over its servers. A server whose tool list is not known yet (not connected) has `tokens: null`, and the target's estimate is marked `complete: false` with the known part summed.

Worked example: `{ name: "noop", inputSchema: { type: "object" } }` on server `scripts` serializes to `{"input_schema":{"type":"object"},"name":"scripts/noop"}`, 56 bytes, so 14 + 4 = 18 tokens.

The constants are `mcpBytesPerToken` and `mcpToolOverheadTokens`. They are an estimate, not a count: once live sessions with MCP servers attached exist (S-06), compare against the change in `assistant.usage` input tokens and adjust the constants here and in the fixtures (`engine/packages/core/tests/mcp-attach/fixtures/expected-tokens.json`).
