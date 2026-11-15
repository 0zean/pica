import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@github/copilot-sdk";
import type { ToolUseInput } from "@pica/core";
import { toRuntimeEvent, type EventContext } from "../../src/copilot/events.ts";
import { bridgeHooks } from "../../src/copilot/hooks.ts";
import { ToolCallLedger } from "../../src/copilot/tool-calls.ts";

const sdkEvent = (type: string, data: Record<string, unknown>, agentId?: string): SessionEvent =>
  ({ id: "e1", timestamp: "2026-11-14T00:00:00.000Z", type, data, ...(agentId === undefined ? {} : { agentId }) }) as unknown as SessionEvent;

const context = (denied: Record<string, string> = {}): EventContext => ({
  sessionId: "s1",
  workingDirectory: "/work/repo",
  modifiedResult: () => undefined,
  deniedReason: (toolCallId) => denied[toolCallId],
});

describe("Copilot event mapping (S-02)", () => {
  it.each(["subagent.started", "subagent.completed", "subagent.failed"])("%s takes the sub-agent id from the envelope", (type) => {
    const event = toRuntimeEvent(sdkEvent(type, { toolCallId: "call-1", agentName: "bulk-reader", error: "x" }, "9f0c"), context());
    expect(event?.data).toMatchObject({ toolCallId: "call-1", agentId: "9f0c" });
  });

  it("reports the model a sub-agent ran on and keeps the requested one (S-03)", () => {
    const data = { toolCallId: "call-1", agentName: "bulk-reader", model: "claude-haiku-4.5", firstDispatchedModel: "gpt-6-luna", totalTokens: 9 };
    expect(toRuntimeEvent(sdkEvent("subagent.completed", data, "9f0c"), context())?.data).toMatchObject({
      model: "gpt-6-luna",
      requestedModel: "claude-haiku-4.5",
    });
    const same = { ...data, firstDispatchedModel: "claude-haiku-4.5" };
    expect(toRuntimeEvent(sdkEvent("subagent.completed", same, "9f0c"), context())?.data).not.toHaveProperty("requestedModel");
  });

  it("maps the session's model change, since session.start carries none (S-01)", () => {
    expect(toRuntimeEvent(sdkEvent("session.model_change", { newModel: "auto", previousModel: "" }), context())?.data).toEqual({ model: "auto" });
  });

  it("does not count cache reads twice: Copilot's inputTokens includes them (S-01)", () => {
    const usage = { model: "m", inputTokens: 11_297, cacheReadTokens: 1_280, outputTokens: 5 };
    expect(toRuntimeEvent(sdkEvent("assistant.usage", usage), context())?.data).toMatchObject({ inputTokens: 10_017, cachedInputTokens: 1_280 });
    const writes = { model: "m", inputTokens: 12_330, cacheWriteTokens: 12_327, outputTokens: 5 };
    expect(toRuntimeEvent(sdkEvent("assistant.usage", writes), context())?.data).toMatchObject({ inputTokens: 12_330, cachedInputTokens: 0 });
  });

  it("carries the initiator and premium requests of a model call", () => {
    const usage = { model: "auto", inputTokens: 1, outputTokens: 1, initiator: "sub-agent", cost: 0 };
    expect(toRuntimeEvent(sdkEvent("assistant.usage", usage, "9f0c"), context())?.data).toMatchObject({ initiator: "sub-agent", premiumRequests: 0 });
  });

  it("falls back to the task call id when the envelope has no agent id", () => {
    const event = toRuntimeEvent(sdkEvent("subagent.started", { toolCallId: "call-1", agentName: "bulk-reader" }), context());
    expect(event?.data).toMatchObject({ agentId: "call-1" });
  });

  it("reports a call the pre hook denied as failed with the policy reason", () => {
    const event = toRuntimeEvent(
      sdkEvent("tool.execution_complete", { toolCallId: "t1", success: true, result: null }),
      context({ t1: "big.sql is 200000 bytes" }),
    );
    expect(event?.data).toEqual({ toolCallId: "t1", success: false, result: { content: "Denied by Pica policy: big.sql is 200000 bytes" } });
  });

  it("carries the billed cost of a model call in credits (S-03)", () => {
    const usage = { model: "gpt-6-luna", inputTokens: 100, outputTokens: 5, copilotUsage: { totalNanoAiu: 412_500_000 } };
    expect(toRuntimeEvent(sdkEvent("assistant.usage", usage), context())?.data).toMatchObject({ billedCredits: 0.4125 });
    const unbilled = toRuntimeEvent(sdkEvent("assistant.usage", { model: "m", inputTokens: 1, outputTokens: 1 }), context());
    expect(unbilled?.data).not.toHaveProperty("billedCredits");
  });

  it("leaves calls that were not denied as the runtime reported them", () => {
    const event = toRuntimeEvent(sdkEvent("tool.execution_complete", { toolCallId: "t2", success: true, result: { content: "ok" } }), context({ t1: "r" }));
    expect(event?.data).toEqual({ toolCallId: "t2", success: true, result: { content: "ok" } });
  });
});

describe("Copilot hook bridge (S-02)", () => {
  it("passes agentType and parentAgentId through and records the deny reason", async () => {
    const seen: ToolUseInput[] = [];
    const ledger = new ToolCallLedger();
    ledger.started("t1", "view");
    const hooks = bridgeHooks(
      { onPreToolUse: (input) => (seen.push(input), Promise.resolve({ decision: "deny", reason: "too big" })) },
      ledger,
      () => "s1",
    );
    const input = { sessionId: "child", timestamp: 0, cwd: "/w", toolName: "view", toolArgs: { path: "a" }, agentId: "9f0c", agentType: "bulk-reader", parentAgentId: "p" };
    await hooks.onPreToolUse?.(input as never, { sessionId: "child" });
    expect(seen[0]).toMatchObject({ toolCallId: "t1", agentId: "9f0c", agentType: "bulk-reader", parentAgentId: "p" });
    expect(ledger.deniedReason("t1")).toBe("too big");
  });
});
