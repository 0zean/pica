import type { PolicyContext, PolicyDecision, ToolCall } from "./types.ts";

// `permissions.mcpTools` in config: an exact `server/tool` entry beats `server/*`; among equals the first wins.
export function mcpToolPermissionRule(call: ToolCall, context: PolicyContext): PolicyDecision | undefined {
  const { target } = call;
  const rules = context.config.permissions.mcpTools;
  if (target.kind !== "mcp" || rules === undefined) {
    return undefined;
  }
  const exact = target.tool === undefined ? undefined : `${target.server}/${target.tool}`;
  const match = rules.find((rule) => rule.tool === exact) ?? rules.find((rule) => rule.tool === `${target.server}/*`);
  if (match === undefined) {
    return undefined;
  }
  const decision = {
    ruleId: `permission.mcp-tool:${match.tool}`,
    ruleGroup: "permission",
    reason: `${match.tool} is set to ${match.permission} in permissions.mcpTools`,
    call,
  } as const;
  return { ...decision, outcome: match.permission };
}
