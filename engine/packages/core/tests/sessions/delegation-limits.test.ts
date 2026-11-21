import { describe, expect, it } from "vitest";
import { PicaConfig } from "@pica/protocol";
import { createReadGate, ok } from "../../src/index.ts";
import type { JsonValue, PolicyDecision, RuntimeHooks, Session } from "../../src/index.ts";

const root = "/work/repo";

const session = (routingProfile: Session["routingProfile"] = "balanced"): Session => ({
  id: "s1",
  workspaceId: "ws",
  writeRoots: [root],
  referenceRoots: [],
  state: "running",
  routingProfile,
  budgetMaxCredits: null,
  createdAt: "2026-11-16T00:00:00.000Z",
  updatedAt: "2026-11-16T00:00:00.000Z",
});

function hooks(
  codeWriter: { maxToolCalls?: number; maxWriteBytes?: number },
  profile: Session["routingProfile"] = "balanced",
  decisions: PolicyDecision[] = [],
): RuntimeHooks {
  return createReadGate({
    sessions: { get: () => ok(session(profile)) },
    config: () => PicaConfig.parse({ routing: { delegation: { codeWriter } } }),
    fileSize: () => Promise.resolve(100),
    onDecision: (_id, decision) => decisions.push(decision),
  })("s1");
}

let callId = 0;
async function call(gate: RuntimeHooks, agentId: string | undefined, agentType: string, toolName: string, args: JsonValue): Promise<string> {
  callId += 1;
  const decision = await gate.onPreToolUse?.({
    sessionId: "s1",
    toolCallId: `t${String(callId)}`,
    toolName,
    arguments: args,
    ...(agentId === undefined ? {} : { agentId, agentType, parentAgentId: "p" }),
  });
  return decision?.decision ?? "none";
}

const view = { path: "src/a.mjs", view_range: [1, 20] };
const create = (bytes: number): JsonValue => ({ path: "test/a.test.mjs", file_text: "x".repeat(bytes) });

describe("delegation limits (C-11)", () => {
  it("denies a code-writer delegation's calls past maxToolCalls, telling it to stop and report", async () => {
    const all: PolicyDecision[] = [];
    const gate = hooks({ maxToolCalls: 3 }, "balanced", all);
    const outcomes = [];
    for (let i = 0; i < 5; i += 1) {
      outcomes.push(await call(gate, "cw-1", "code-writer", i % 2 === 0 ? "view" : "edit", view));
    }
    expect(outcomes).toEqual(["allow", "allow", "allow", "deny", "deny"]);
    const decisions = all.filter((decision) => decision.outcome === "deny");
    expect(decisions.map((decision) => decision.ruleId)).toEqual(["cost.delegation-limit", "cost.delegation-limit"]);
    expect(decisions[0]?.reason).toContain("3 tool calls");
    expect(decisions[0]?.reason).toContain("Reply now with the files you changed");
    expect(decisions[0]?.call.agent).toBe("code-writer");
  });

  it("counts each delegation apart, by agentId", async () => {
    const gate = hooks({ maxToolCalls: 1 });
    expect(await call(gate, "cw-1", "code-writer", "view", view)).toBe("allow");
    expect(await call(gate, "cw-1", "code-writer", "view", view)).toBe("deny");
    expect(await call(gate, "cw-2", "code-writer", "view", view)).toBe("allow");
  });

  it("ends the delegation at a write past maxWriteBytes: later calls are denied, smaller writes included", async () => {
    const all: PolicyDecision[] = [];
    const gate = hooks({ maxWriteBytes: 1000 }, "balanced", all);
    expect(await call(gate, "cw-1", "code-writer", "create", create(600))).toBe("allow");
    expect(await call(gate, "cw-1", "code-writer", "create", create(600))).toBe("deny");
    expect(await call(gate, "cw-1", "code-writer", "create", create(100))).toBe("deny");
    expect(await call(gate, "cw-1", "code-writer", "view", view)).toBe("deny");
    expect(all.find((decision) => decision.outcome === "deny")?.reason).toContain("1000 bytes of writes");
    expect(await call(gate, "cw-2", "code-writer", "create", create(100))).toBe("allow");
  });

  it("after the first limit denial, says on each repeat that the delegation has ended and counts the repeats", async () => {
    const all: PolicyDecision[] = [];
    const gate = hooks({ maxToolCalls: 1 }, "balanced", all);
    await call(gate, "cw-1", "code-writer", "view", view);
    for (let i = 0; i < 4; i += 1) {
      expect(await call(gate, "cw-1", "code-writer", "view", view)).toBe("deny");
    }
    const reasons = all.filter((decision) => decision.outcome === "deny").map((decision) => decision.reason);
    expect(all.filter((decision) => decision.outcome === "deny").every((decision) => decision.ruleId === "cost.delegation-limit")).toBe(true);
    expect(reasons[0]).toContain("so it has ended");
    expect(reasons[0]).toContain("every later one will be denied");
    expect(reasons[1]).toContain("ended when it reached its limit of 1 tool calls, and 1 call has been denied since");
    expect(reasons[3]).toContain("3 calls have been denied since");
    expect(reasons[3]).toContain("Do not call any tool. Reply now, in text");
  });

  it("applies under strict but not under off, and not to other agents or the main agent", async () => {
    expect(await call(hooks({ maxToolCalls: 1 }, "strict"), "cw", "code-writer", "view", view)).toBe("allow");
    const strict = hooks({ maxToolCalls: 1 }, "strict");
    await call(strict, "cw", "code-writer", "view", view);
    expect(await call(strict, "cw", "code-writer", "view", view)).toBe("deny");

    const off = hooks({ maxToolCalls: 1 }, "off");
    await call(off, "cw", "code-writer", "view", view);
    expect(await call(off, "cw", "code-writer", "view", view)).toBe("allow");

    const other = hooks({ maxToolCalls: 1 });
    for (let i = 0; i < 3; i += 1) {
      expect(await call(other, "br", "bulk-reader", "view", view)).toBe("allow");
      expect(await call(other, undefined, "main", "edit", { path: "src/a.mjs", old_str: "a", new_str: "b" })).toBe("allow");
    }
  });

  it("defaults to 12 calls and 32 KB per code-writer delegation", () => {
    expect(PicaConfig.parse({}).routing.delegation.codeWriter).toEqual({ maxToolCalls: 12, maxWriteBytes: 32768 });
  });
});
