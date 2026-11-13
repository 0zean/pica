import { isInsideAny, resolvePath } from "./paths.ts";
import { targetPaths } from "./target-paths.ts";
import type { ManagedRule, PolicyContext, Rule, ToolCall } from "./types.ts";

export const managedRule: Rule = (call, context) => {
  const match = context.managed.find((rule) => matches(rule, call, context));
  if (match === undefined) {
    return undefined;
  }
  return { outcome: "deny", ruleId: `managed:${match.id}`, ruleGroup: "managed", reason: match.reason, call };
};

function matches(rule: ManagedRule, call: ToolCall, context: PolicyContext): boolean {
  const { target } = call;
  return (
    listMatches(rule.tools, call.tool) &&
    listMatches(rule.kinds, target.kind) &&
    listMatches(rule.agents, call.agent) &&
    listMatches(rule.mcpServers, target.kind === "mcp" ? target.server : undefined) &&
    commandMatches(rule.commandPattern, target.kind === "shell" ? target.command : undefined) &&
    pathMatches(rule.pathPrefixes, call, context)
  );
}

function listMatches<T>(allowed: readonly T[] | undefined, value: T | undefined): boolean {
  return allowed === undefined || (value !== undefined && allowed.includes(value));
}

function commandMatches(pattern: RegExp | undefined, command: string | undefined): boolean {
  return pattern === undefined || (command !== undefined && pattern.test(command));
}

function pathMatches(prefixes: readonly string[] | undefined, call: ToolCall, context: PolicyContext): boolean {
  if (prefixes === undefined) {
    return true;
  }
  const roots = prefixes.map((prefix) => resolvePath("/", prefix));
  return targetPaths(call.target).some((path) => isInsideAny(resolvePath(context.cwd, path), roots));
}
