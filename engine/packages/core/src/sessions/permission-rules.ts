import type { ToolPermissionRule } from "@pica/protocol";
import type { JsonValue } from "../json.ts";

// A-07: `permissions.tools` rules answer the runtime's permission prompts (docs/approvals.md).
// "Always allow" on an approval writes the rule `ruleFor` derives; the next prompt it matches is
// answered without asking.

export interface PermissionRules {
  // Read on every prompt, so an edit to the config applies to running sessions.
  readonly current: () => readonly ToolPermissionRule[];
  // Appends a rule to the user's config. An identical rule already there is not added twice.
  readonly add: (rule: ToolPermissionRule) => { readonly ok: true } | { readonly ok: false; readonly message: string };
}

const subjectKeys = ["command", "path", "url"] as const;

// What makes two prompts for the same tool the same request: the call's command (shell), path
// (file tools) or url (fetch). Other arguments, such as an edit's text, are not compared.
export function requestSubject(args: JsonValue): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return undefined;
  }
  const object = args as { readonly [key: string]: JsonValue };
  for (const key of subjectKeys) {
    const value = object[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function ruleFor(toolName: string, args: JsonValue, permission: ToolPermissionRule["permission"]): ToolPermissionRule {
  const match = requestSubject(args);
  return match === undefined ? { tool: toolName, permission } : { tool: toolName, match, permission };
}

// A rule with `match` beats one without; at the same level, deny beats allow.
export function matchingRule(
  rules: readonly ToolPermissionRule[],
  toolName: string,
  args: JsonValue,
): ToolPermissionRule | undefined {
  const subject = requestSubject(args);
  const forTool = rules.filter((rule) => rule.tool === toolName);
  const exact = forTool.filter((rule) => rule.match !== undefined && rule.match === subject);
  const any = forTool.filter((rule) => rule.match === undefined);
  for (const level of [exact, any]) {
    const chosen = level.find((rule) => rule.permission === "deny") ?? level[0];
    if (chosen !== undefined) {
      return chosen;
    }
  }
  return undefined;
}

export function sameRule(a: ToolPermissionRule, b: ToolPermissionRule): boolean {
  return a.tool === b.tool && a.match === b.match && a.permission === b.permission;
}

export function describeRule(rule: ToolPermissionRule): string {
  return rule.match === undefined ? `every ${rule.tool} call` : `${rule.tool} ${rule.match}`;
}
