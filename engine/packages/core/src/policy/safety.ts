import { isInsideAny, joinPath, realPath } from "./paths.ts";
import { shellPaths, type ShellPath } from "./shell-paths.ts";
import { targetPaths } from "./target-paths.ts";
import type { PolicyContext, PolicyDecision, Rule, ToolCall } from "./types.ts";

// Shell working directories are judged by `shellScopeRule`, which can ask instead of deny.
export const outsideRootsRule: Rule = (call, context) => {
  if (call.target.kind === "shell") {
    return undefined;
  }
  const roots = realRoots([...context.writeRoots, ...context.referenceRoots], context);
  const outside = realTargetPaths(call, context).find((path) => !isInsideAny(path, roots));
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
  if (call.target.kind !== "write") {
    return undefined;
  }
  const roots = realRoots(context.writeRoots, context);
  const outside = realTargetPaths(call, context).find((path) => !isInsideAny(path, roots));
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

// A command that runs or writes outside the write roots needs a person: ask, or deny in auto mode.
export const shellScopeRule: Rule = (call, context) => {
  const { target } = call;
  if (target.kind !== "shell" || call.result !== undefined) {
    return undefined;
  }
  const roots = realRoots(context.writeRoots, context);
  const outside = shellPaths(target.command, joinPath(context.cwd, target.cwd)).find(
    (entry) => entry.path === undefined || !isInsideAny(realPath(entry.path, context), roots),
  );
  return outside === undefined ? undefined : shellScopeDecision(call, context, outside);
};

function shellScopeDecision(call: ToolCall, context: PolicyContext, outside: ShellPath): PolicyDecision {
  const where =
    outside.path === undefined
      ? `${outside.role} ${outside.raw} cannot be resolved before the command runs`
      : `${outside.role} ${realPath(outside.path, context)} is outside the session's write roots`;
  const base = { ruleId: "safety.shell-outside-write-roots", ruleGroup: "safety", call } as const;
  if (context.config.permissions.mode === "auto") {
    return { ...base, outcome: "deny", reason: `${where}; permission mode is auto, so it is denied` };
  }
  return { ...base, outcome: "ask", reason: `${where}; approve to run it` };
}

function realRoots(roots: readonly string[], context: PolicyContext): string[] {
  return roots.map((root) => realPath(root, context));
}

function realTargetPaths(call: ToolCall, context: PolicyContext): string[] {
  return targetPaths(call.target).map((path) => realPath(joinPath(context.cwd, path), context));
}
