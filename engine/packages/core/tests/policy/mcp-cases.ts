import type { McpToolPermission } from "@pica/protocol";
import type { ManagedMcpServer, PolicyContext, ToolCall, ToolTarget } from "../../src/index.ts";
import type { Case } from "./cases.ts";
import { policyConfig, toolCall, writeRoot } from "./fixtures.ts";

// M-05: per-tool MCP permissions, the write-class default, and the managed MCP allowlist.

const mcpTool = (server: string, tool: string, readOnly = false): ToolTarget => ({ kind: "mcp", server, tool, readOnly });
const call = (target: ToolTarget, overrides: Partial<ToolCall> = {}): ToolCall =>
  toolCall(target, { tool: target.kind === "mcp" ? `${target.server}-${target.tool ?? "unknown"}` : "view", ...overrides });

type ToolRule = readonly [tool: string, permission: McpToolPermission];

const tools = (rules: readonly ToolRule[], mode: "ask" | "auto" = "ask"): Partial<PolicyContext> => ({
  config: policyConfig({ permissions: { mode, mcpTools: rules.map(([tool, permission]) => ({ tool, permission })) } }),
});
const allowlist = (...servers: ManagedMcpServer[]): Partial<PolicyContext> => ({
  managedMcpAllowlist: { id: "org-mcp", servers },
});

const createIssue = mcpTool("github", "create_issue");
const searchIssues = mcpTool("github", "search_issues", true);
const dropTable = mcpTool("snowflake", "drop_table");

export const mcpPermissionCases: Case[] = [
  { name: "a write-class MCP tool asks by default", call: call(createIssue), outcome: "ask", ruleId: "permission.ask" },
  { name: "an MCP tool with no class info is write-class", call: call({ kind: "mcp", server: "github", tool: "create_issue" }), outcome: "ask", ruleId: "permission.ask" },
  { name: "a read-only MCP tool runs without asking", call: call(searchIssues), outcome: "allow", ruleId: "permission.mcp-read-only" },
  { name: "an empty mcpTools list keeps the write-class default", call: call(createIssue), context: tools([]), outcome: "ask", ruleId: "permission.ask" },
  { name: "auto mode with no per-tool rules allows a write-class MCP tool", call: call(createIssue), context: { config: policyConfig({ permissions: { mode: "auto" } }) }, outcome: "allow", ruleId: "permission.auto" },
  { name: "a per-tool allow skips the write-class ask", call: call(createIssue), context: tools([["github/create_issue", "allow"]]), outcome: "allow", ruleId: "permission.mcp-tool:github/create_issue" },
  { name: "a per-tool ask applies to a read-only tool", call: call(searchIssues), context: tools([["github/search_issues", "ask"]]), outcome: "ask", ruleId: "permission.mcp-tool:github/search_issues" },
  { name: "a per-tool deny blocks the tool", call: call(dropTable), context: tools([["snowflake/drop_table", "deny"]]), outcome: "deny", ruleId: "permission.mcp-tool:snowflake/drop_table" },
  { name: "a per-tool deny holds in auto mode", call: call(dropTable), context: tools([["snowflake/drop_table", "deny"]], "auto"), outcome: "deny", ruleId: "permission.mcp-tool:snowflake/drop_table" },
  { name: "a per-tool ask holds in auto mode", call: call(createIssue), context: tools([["github/create_issue", "ask"]], "auto"), outcome: "ask", ruleId: "permission.mcp-tool:github/create_issue" },
  { name: "server/* applies to every tool on the server", call: call(createIssue), context: tools([["github/*", "deny"]]), outcome: "deny", ruleId: "permission.mcp-tool:github/*" },
  { name: "server/* applies to a call with no tool name", call: call({ kind: "mcp", server: "github" }), context: tools([["github/*", "allow"]]), outcome: "allow", ruleId: "permission.mcp-tool:github/*" },
  { name: "an exact tool beats server/* listed before it", call: call(createIssue), context: tools([["github/*", "deny"], ["github/create_issue", "allow"]]), outcome: "allow", ruleId: "permission.mcp-tool:github/create_issue" },
  { name: "server/* still covers the server's other tools", call: call(mcpTool("github", "merge_pull_request")), context: tools([["github/*", "deny"], ["github/create_issue", "allow"]]), outcome: "deny", ruleId: "permission.mcp-tool:github/*" },
  { name: "the first of two equal entries wins", call: call(createIssue), context: tools([["github/create_issue", "deny"], ["github/create_issue", "allow"]]), outcome: "deny", ruleId: "permission.mcp-tool:github/create_issue" },
  { name: "rules for another server do not apply", call: call(createIssue), context: tools([["snowflake/*", "allow"]]), outcome: "ask", ruleId: "permission.ask" },
  { name: "a rule for another tool does not apply", call: call(searchIssues), context: tools([["github/create_issue", "deny"]]), outcome: "allow", ruleId: "permission.mcp-read-only" },
  { name: "MCP rules do not apply to non-MCP calls", call: call({ kind: "write", path: `${writeRoot}/github` }), context: tools([["github/*", "deny"]]), outcome: "ask", ruleId: "permission.ask" },
  { name: "an MCP result passes even when the tool is denied", call: call(dropTable, { result: { bytes: 10 } }), context: tools([["snowflake/drop_table", "deny"]]), outcome: "allow", ruleId: "permission.result" },
  { name: "managed deny beats a per-tool allow", call: call(createIssue), context: { ...tools([["github/create_issue", "allow"]]), managed: [{ id: "no-gh", reason: "GitHub writes are blocked", mcpServers: ["github"] }] }, outcome: "deny", ruleId: "managed:no-gh" },
  { name: "managed deny beats a read-only hint", call: call(searchIssues), context: { managed: [{ id: "no-gh", reason: "GitHub is blocked", mcpServers: ["github"] }] }, outcome: "deny", ruleId: "managed:no-gh" },
  { name: "managed deny of one tool beats auto mode", call: call(dropTable), context: { ...tools([], "auto"), managed: [{ id: "no-drop", reason: "Dropping tables is blocked", tools: ["snowflake-drop_table"] }] }, outcome: "deny", ruleId: "managed:no-drop" },
  { name: "a server off the managed allowlist is denied", call: call(searchIssues), context: allowlist({ id: "datadog" }), outcome: "deny", ruleId: "managed:org-mcp" },
  { name: "the managed allowlist beats a per-tool allow and auto mode", call: call(createIssue), context: { ...tools([["github/*", "allow"]], "auto"), ...allowlist({ id: "datadog" }) }, outcome: "deny", ruleId: "managed:org-mcp" },
  { name: "a server on the managed allowlist falls through to permissions", call: call(createIssue), context: allowlist({ id: "github" }), outcome: "ask", ruleId: "permission.ask" },
  { name: "an empty managed allowlist denies every MCP server", call: call(searchIssues), context: allowlist(), outcome: "deny", ruleId: "managed:org-mcp" },
  { name: "the managed allowlist ignores non-MCP calls", call: call({ kind: "read", path: `${writeRoot}/a.ts`, sizeBytes: 10 }), context: allowlist(), outcome: "allow", ruleId: "permission.read-only" },
];

