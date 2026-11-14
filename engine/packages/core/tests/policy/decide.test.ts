import { describe, expect, it } from "vitest";
import { decide } from "../../src/index.ts";
import { groups, largeRead, managed, maxBytes, other, rangeExemptLines, shell, withResult } from "./cases.ts";
import { baseContext, toolCall } from "./fixtures.ts";
import { mcpPermissionCases } from "./mcp-cases.ts";
import { scopeCases, shellScopeCases } from "./scope-cases.ts";

describe("decide", () => {
  it("has at least 60 table cases", () => {
    expect(Object.values(groups).flat().length).toBeGreaterThanOrEqual(60);
  });

  for (const [group, cases] of Object.entries({
    ...groups,
    "MCP permissions (M-05)": mcpPermissionCases,
    "session scope (R-07)": scopeCases,
    "shell scope (R-07)": shellScopeCases,
  })) {
    describe(group, () => {
      it.each(cases)("$name", ({ call, context, outcome, ruleId }) => {
        const decision = decide(call, baseContext(context));
        expect({ outcome: decision.outcome, ruleId: decision.ruleId }).toEqual({ outcome, ruleId });
        expect(decision.call).toBe(call);
        expect(decision.ruleGroup).toBe(ruleId.split(/[.:]/)[0]);
        expect(decision.reason).not.toBe("");
      });
    });
  }

  it("names bulk-reader and the sizes in a large-read denial", () => {
    const decision = decide(toolCall(largeRead()), baseContext());
    expect(decision.reason).toContain("bulk-reader");
    expect(decision.reason).toContain("212000");
    expect(decision.reason).toContain(String(rangeExemptLines));
  });

  it("carries the truncation limit in an oversized-output rewrite", () => {
    const decision = decide(withResult(shell("ls"), 50_000), baseContext());
    expect(decision).toMatchObject({ outcome: "rewrite", rewrite: { kind: "truncate", maxBytes, originalBytes: 50_000 } });
  });

  it("uses the managed rule's reason", () => {
    const decision = decide(toolCall(other), baseContext(managed({ id: "x", reason: "Org says no" })));
    expect(decision.reason).toBe("Org says no");
  });
});
