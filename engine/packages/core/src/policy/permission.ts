import type { PolicyDecision, ToolCall, PolicyContext } from "./types.ts";

// The last group always decides, so it is not a `Rule` that may pass.
export function permissionRule(call: ToolCall, context: PolicyContext): PolicyDecision {
  if (call.result !== undefined) {
    return { outcome: "allow", ruleId: "permission.result", ruleGroup: "permission", reason: "Result passes unchanged", call };
  }
  if (context.config.permissions.mode === "auto") {
    return { outcome: "allow", ruleId: "permission.auto", ruleGroup: "permission", reason: "Permission mode is auto", call };
  }
  const { kind } = call.target;
  if (kind === "read" || kind === "search") {
    return { outcome: "allow", ruleId: "permission.read-only", ruleGroup: "permission", reason: "Read-only tools run without asking", call };
  }
  return { outcome: "ask", ruleId: "permission.ask", ruleGroup: "permission", reason: `Permission mode is ask; ${call.tool} needs approval`, call };
}
