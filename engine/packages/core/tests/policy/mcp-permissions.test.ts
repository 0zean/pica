import { describe, expect, it } from "vitest";
import type { McpToolDefinition } from "../../src/index.ts";
import { decide, mcpToolTarget } from "../../src/index.ts";
import { baseContext, toolCall } from "./fixtures.ts";
import { mcpPermissionCases } from "./mcp-cases.ts";

const outcomes = new Set(mcpPermissionCases.map((entry) => entry.outcome));

const tool = (name: string, annotations?: McpToolDefinition["annotations"]): McpToolDefinition => ({
  name,
  inputSchema: { type: "object" },
  ...(annotations === undefined ? {} : { annotations }),
});

describe("MCP permissions", () => {
  it("covers allow, ask and deny", () => {
    expect([...outcomes].sort()).toEqual(["allow", "ask", "deny"]);
  });

  it.each(mcpPermissionCases)("$name", ({ call, context, outcome, ruleId }) => {
    const decision = decide(call, baseContext(context));
    expect({ outcome: decision.outcome, ruleId: decision.ruleId }).toEqual({ outcome, ruleId });
  });

  it("names the policy when the managed allowlist denies a call", () => {
    const call = toolCall({ kind: "mcp", server: "github", tool: "create_issue" });
    const decision = decide(call, baseContext({ managedMcpAllowlist: { id: "org-mcp", servers: [] } }));
    expect(decision.reason).toBe("MCP server github is not on the managed MCP allowlist (policy managed:org-mcp)");
  });

  it("says why a write-class MCP tool asks", () => {
    const decision = decide(toolCall({ kind: "mcp", server: "github", tool: "create_issue" }), baseContext());
    expect(decision.reason).toContain("not marked read-only");
  });
});

describe("mcpToolTarget", () => {
  it("is read-class only with readOnlyHint: true", () => {
    expect(mcpToolTarget("github", "search_issues", tool("search_issues", { readOnlyHint: true }))).toEqual({
      kind: "mcp",
      server: "github",
      tool: "search_issues",
      readOnly: true,
    });
  });

  it.each([
    ["no annotations", tool("create_issue")],
    ["readOnlyHint false", tool("create_issue", { readOnlyHint: false })],
    ["only a non-destructive hint", tool("create_issue", { destructiveHint: false })],
    ["an unknown tool", undefined],
  ])("is write-class with %s", (_label, definition) => {
    expect(mcpToolTarget("github", "create_issue", definition)).toMatchObject({ readOnly: false });
  });

  it("turns a read-only tool into an allow and a write tool into an ask", () => {
    const context = baseContext();
    const read = decide(toolCall(mcpToolTarget("github", "search_issues", tool("search_issues", { readOnlyHint: true }))), context);
    const write = decide(toolCall(mcpToolTarget("github", "create_issue", tool("create_issue", { destructiveHint: true }))), context);
    expect([read.outcome, write.outcome]).toEqual(["allow", "ask"]);
  });
});
