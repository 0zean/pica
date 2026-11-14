import type { Rule } from "./types.ts";

// Backs up the attach-time check (mcp-attach): a call to a server off the list is denied even if
// it reached the session some other way.
export const managedMcpAllowlistRule: Rule = (call, context) => {
  const { target } = call;
  const allowlist = context.managedMcpAllowlist;
  if (allowlist === undefined || target.kind !== "mcp" || allowlist.servers.some((server) => server.id === target.server)) {
    return undefined;
  }
  return {
    outcome: "deny",
    ruleId: `managed:${allowlist.id}`,
    ruleGroup: "managed",
    reason: `MCP server ${target.server} is not on the managed MCP allowlist (policy managed:${allowlist.id})`,
    call,
  };
};
