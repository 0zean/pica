import { PicaConfig } from "@pica/protocol";
import { defaultCommandDenyList, type PolicyConfig, type PolicyContext, type ToolCall, type ToolTarget } from "../../src/index.ts";

export const writeRoot = "/work/repo";
export const referenceRoot = "/ref/lib";

// The tables test the cost gates, which only `balanced` and `strict` apply. Since D-22 the product
// default is `off`, so a case that sets no profile runs under `balanced`.
export function policyConfig(overrides: unknown = {}): PolicyConfig {
  const given = isObject(overrides) ? overrides : {};
  const routing = isObject(given["routing"]) ? given["routing"] : {};
  return PicaConfig.parse({ ...given, routing: { profile: "balanced", ...routing } });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function baseContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    cwd: writeRoot,
    writeRoots: [writeRoot],
    referenceRoots: [referenceRoot],
    config: policyConfig(),
    managed: [],
    commandDenyList: defaultCommandDenyList,
    ...overrides,
  };
}

export function toolCall(target: ToolTarget, overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: "call-1", tool: toolNameFor(target), agent: "main", target, ...overrides };
}

function toolNameFor(target: ToolTarget): string {
  switch (target.kind) {
    case "read":
      return "view";
    case "write":
      return "edit";
    case "search":
      return "grep";
    case "shell":
      return "bash";
    case "mcp":
      return "github-search_issues";
    case "other":
      return "think";
  }
}
