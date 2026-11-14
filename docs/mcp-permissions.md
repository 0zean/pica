# MCP permissions

M-05 decides whether a call to an MCP tool runs, asks, or is refused, and which MCP servers an organization lets a session use at all. Code: `engine/packages/core/src/policy/` (`mcp-permission.ts`, `mcp-allowlist.ts`, `permission.ts`) and `engine/packages/core/src/mcp-attach/` (`managed-allowlist.ts`, `tool-target.ts`). Both are pure.

## Read-class and write-class

The policy sees an MCP call as `{ kind: "mcp", server, tool?, readOnly? }`. `mcpToolTarget(serverId, toolName, definition)` builds it from the tool's `tools/list` entry:

- **Read-class** only when the server marks the tool `annotations.readOnlyHint: true`.
- **Write-class** otherwise: no annotations, `readOnlyHint: false`, an unknown tool, or a call with no class info. `destructiveHint` and `idempotentHint` do not change the class; any tool that may write needs approval, destructive or not.

Annotations are hints from the server, and the MCP spec says clients should not trust them from untrusted servers. The conservative default (no hint means write) means a server can only lower the bar by explicitly claiming a tool is read-only. A server that lies is caught by the layers above it: the managed allowlist decides which servers may run at all, and per-tool rules override the hint.

## Per-tool rules

`permissions.mcpTools` in `config.jsonc` (any layer, PLAN.md §4.6):

```jsonc
{
  "permissions": {
    "mode": "ask",
    "mcpTools": [
      { "tool": "github/create_issue", "permission": "allow" },
      { "tool": "snowflake/*", "permission": "ask" },
      { "tool": "snowflake/drop_table", "permission": "deny" }
    ]
  }
}
```

- `tool` is `server/tool` or `server/*`. An exact entry beats `server/*` wherever it appears in the list; among equal entries the first wins.
- The list is an array, so a higher config layer replaces the whole list rather than merging into it. (Server ids and tool names may contain `.`, which the layer merge uses as a key separator, so a keyed map would not layer correctly.)
- A matching entry decides the call in both permission modes (rule id `permission.mcp-tool:<tool>`). A `deny` or `ask` here holds even in `auto` mode.

## Order within the permission group

After managed, safety and cost rules (PLAN.md §5.3), an MCP call is decided by the first of:

1. A tool result (post-tool-use) passes: `permission.result`.
2. A matching `permissions.mcpTools` entry: `permission.mcp-tool:<tool>`.
3. Mode `auto` allows: `permission.auto`.
4. A read-class tool is allowed: `permission.mcp-read-only`.
5. A write-class tool asks: `permission.ask`.

`auto` mode allowing write-class MCP tools is deliberate: it is the user's explicit choice. Organizations that want MCP writes gated in `auto` set per-tool rules in a locked (managed) config layer, or H-01's permission-mode floor.

## Managed MCP allowlist

`ManagedMcpAllowlist = { id, servers: [{ id, url?, command? }] }`. H-01 loads it from the managed policy; until then callers pass it in. When present:

- **Attach time.** `attachMcpServers(definitions, agents, attachments, allowlist)` refuses an attachment whose server is not on the list, with issue code `mcp_attach.not_in_managed_allowlist`, `policy: "managed:<id>"`, and a message naming the policy. A `url` (remote) or `command` (stdio) on an entry pins it: a definition with that id but a different endpoint, or a different transport, is refused the same way, so renaming a server to an allowed id does not get it through.
- **Call time.** `PolicyContext.managedMcpAllowlist` adds a managed rule after the managed deny rules: a call to a server off the list is denied with rule id `managed:<id>`. Like every managed deny, nothing later overrides it.

With no allowlist, every defined server may be attached.
