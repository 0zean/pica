import { largeReadRule, oversizedOutputRule } from "./cost.ts";
import { managedRule } from "./managed.ts";
import { managedMcpAllowlistRule } from "./mcp-allowlist.ts";
import { permissionRule } from "./permission.ts";
import { commandDenyListRule, outsideRootsRule, outsideWriteRootsRule } from "./safety.ts";
import type { PolicyContext, PolicyDecision, Rule, ToolCall } from "./types.ts";

/** PLAN.md §5.3: managed policy, then safety, then cost gates, then permission mode. First match wins. */
export const orderedRules: readonly Rule[] = [
  managedRule,
  managedMcpAllowlistRule,
  outsideRootsRule,
  outsideWriteRootsRule,
  commandDenyListRule,
  largeReadRule,
  oversizedOutputRule,
];

export function decide(call: ToolCall, context: PolicyContext): PolicyDecision {
  for (const rule of orderedRules) {
    const decision = rule(call, context);
    if (decision !== undefined) {
      return decision;
    }
  }
  return permissionRule(call, context);
}
