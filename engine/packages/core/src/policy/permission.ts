import { mcpToolPermissionRule } from "./mcp-permission.ts";
import type { PolicyDecision, ToolCall, PolicyContext } from "./types.ts";

// The last group always decides, so it is not a `Rule` that may pass.
export function permissionRule(call: ToolCall, context: PolicyContext): PolicyDecision {
  if (call.result !== undefined) {
    return { outcome: "allow", ruleId: "permission.result", ruleGroup: "permission", reason: "Result passes unchanged", call };
  }
  const configured = mcpToolPermissionRule(call, context);
  if (configured !== undefined) {
    return configured;
  }
  if (context.config.permissions.mode === "auto") {
    return { outcome: "allow", ruleId: "permission.auto", ruleGroup: "permission", reason: "Permission mode is auto", call };
  }
  const { target } = call;
  if (target.kind === "read" || target.kind === "search") {
    return { outcome: "allow", ruleId: "permission.read-only", ruleGroup: "permission", reason: "Read-only tools run without asking", call };
  }
  if (target.kind === "mcp") {
    return mcpDefault(call, target.readOnly === true);
  }
  return { outcome: "ask", ruleId: "permission.ask", ruleGroup: "permission", reason: `Permission mode is ask; ${call.tool} needs approval`, call };
}

// Write-class is the default: an MCP tool asks unless its server marks it read-only.
function mcpDefault(call: ToolCall, readOnly: boolean): PolicyDecision {
  if (readOnly) {
    return { outcome: "allow", ruleId: "permission.mcp-read-only", ruleGroup: "permission", reason: "Read-only MCP tools run without asking", call };
  }
  return { outcome: "ask", ruleId: "permission.ask", ruleGroup: "permission", reason: `${call.tool} may write; MCP tools not marked read-only need approval`, call };
}
