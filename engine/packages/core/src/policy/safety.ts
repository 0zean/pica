import { isInsideAny, resolvePath } from "./paths.ts";
import { targetPaths } from "./target-paths.ts";
import type { PolicyContext, Rule, ToolCall } from "./types.ts";

export const outsideRootsRule: Rule = (call, context) => {
  const roots = normalizedRoots([...context.writeRoots, ...context.referenceRoots]);
  const outside = resolvedPaths(call, context).find((path) => !isInsideAny(path, roots));
  if (outside === undefined) {
    return undefined;
  }
  return {
    outcome: "deny",
    ruleId: "safety.outside-roots",
    ruleGroup: "safety",
    reason: `${outside} is outside the session's roots`,
    call,
  };
};

export const outsideWriteRootsRule: Rule = (call, context) => {
  const { kind } = call.target;
  if (kind !== "write" && kind !== "shell") {
    return undefined;
  }
  const roots = normalizedRoots(context.writeRoots);
  const outside = resolvedPaths(call, context).find((path) => !isInsideAny(path, roots));
  if (outside === undefined) {
    return undefined;
  }
  return {
    outcome: "deny",
    ruleId: "safety.outside-write-roots",
    ruleGroup: "safety",
    reason: `${outside} is outside the session's write roots; it is read-only`,
    call,
  };
};

export const commandDenyListRule: Rule = (call, context) => {
  const { target } = call;
  if (target.kind !== "shell") {
    return undefined;
  }
  const match = context.commandDenyList.find((rule) => rule.pattern.test(target.command));
  if (match === undefined) {
    return undefined;
  }
  return {
    outcome: "deny",
    ruleId: `safety.command-denied:${match.id}`,
    ruleGroup: "safety",
    reason: match.reason,
    call,
  };
};

function normalizedRoots(roots: readonly string[]): string[] {
  return roots.map((root) => resolvePath("/", root));
}

function resolvedPaths(call: ToolCall, context: PolicyContext): string[] {
  return targetPaths(call.target).map((path) => resolvePath(context.cwd, path));
}
