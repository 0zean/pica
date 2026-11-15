import { describe, expect, it } from "vitest";
import { initialNormalizerState, normalizeRuntimeEvent } from "../../src/events/normalize.ts";
import type { EventDraft, IncomingRuntimeEvent, NormalizerState } from "../../src/events/normalize.ts";
import { createRuntimeEventRecorder } from "../../src/events/recorder.ts";
import type { EventLog } from "../../src/events/index.ts";
import { ok } from "../../src/index.ts";

const context = { sessionId: "s1", rootAgent: "main" };
let clock = 0;
const at = (type: string, data: unknown, agentId?: string): IncomingRuntimeEvent => ({
  id: `e${String(clock)}`,
  timestamp: new Date(Date.UTC(2026, 10, 14, 0, 0, 0, clock++)).toISOString(),
  type,
  data: agentId === undefined ? data : { ...(data as object), agentId },
});

function run(events: readonly IncomingRuntimeEvent[], state: NormalizerState = initialNormalizerState) {
  const drafts: EventDraft[] = [];
  let current = state;
  for (const event of events) {
    const normalized = normalizeRuntimeEvent(current, event, context);
    current = normalized.state;
    drafts.push(...normalized.drafts);
  }
  return { drafts, state: current };
}

// The order S-03 recorded when a turn was aborted inside a sub-agent.
const delegating = [
  at("tool.execution_start", { toolCallId: "task-1", toolName: "task", arguments: {} }),
  at("subagent.started", { toolCallId: "task-1", agentId: "sub-1", agentName: "bulk-reader", model: "auto" }),
  at("tool.execution_start", { toolCallId: "rg-1", toolName: "rg", arguments: {}, agentId: "sub-1" }),
];

describe("aborted turns (S-03)", () => {
  it("closes open tool calls and sub-agents as failed and drops the late completion", () => {
    const { drafts } = run([
      ...delegating,
      at("abort", { reason: "user_initiated" }),
      at("subagent.completed", { toolCallId: "task-1", agentId: "sub-1", agentName: "bulk-reader", model: "auto", totalTokens: 5 }),
      at("tool.execution_complete", { toolCallId: "rg-1", success: false, result: { content: "Tool execution aborted." }, agentId: "sub-1" }),
    ]);
    expect(drafts.map((draft) => draft.type)).toEqual([
      "tool.started",
      "subagent.started",
      "tool.started",
      "tool.failed",
      "tool.failed",
      "subagent.failed",
      "session.aborted",
    ]);
    expect(drafts[3]?.payload).toMatchObject({ toolCallId: "task-1", error: "Interrupted: the turn was aborted" });
    expect(drafts[4]?.payload).toMatchObject({ toolCallId: "rg-1", agent: "bulk-reader", parentToolCallId: "task-1" });
    expect(drafts[5]?.payload).toEqual({ toolCallId: "task-1", agent: "bulk-reader", error: "Interrupted: the turn was aborted" });
  });

  it("lets the session service record the abort with its own reason", () => {
    const appended: EventDraft[] = [];
    const log: EventLog = {
      append: (_sessionId, draft) => {
        appended.push(draft);
        return ok({ ...draft, sessionId: "s1", seq: appended.length } as never);
      },
      subscribe: () => ({ close: () => undefined }),
    };
    const recorder = createRuntimeEventRecorder(log, context);
    delegating.forEach((event) => recorder.record(event));
    const outcome = recorder.interrupt("2026-11-14T00:00:01.000Z");
    expect(outcome.appended.map((event) => event.type)).toEqual(["tool.failed", "tool.failed", "subagent.failed"]);
    expect(recorder.interrupt("2026-11-14T00:00:02.000Z").appended).toEqual([]);
  });

  it("reports the model a sub-agent ran on, and the requested one when they differ", () => {
    const { drafts } = run([
      at("subagent.started", { toolCallId: "task-1", agentId: "sub-1", agentName: "bulk-reader", model: "claude-haiku-4.5" }),
      at("subagent.completed", { toolCallId: "task-1", agentId: "sub-1", agentName: "bulk-reader", model: "gpt-6-luna", requestedModel: "claude-haiku-4.5", totalTokens: 5 }),
    ]);
    expect(drafts[1]?.payload).toMatchObject({ model: "gpt-6-luna", requestedModel: "claude-haiku-4.5" });
  });

  it("keeps the sub-agent instance, initiator and premium requests on usage", () => {
    const { drafts } = run([
      at("subagent.started", { toolCallId: "task-1", agentId: "sub-1", agentName: "bulk-reader", model: "auto" }),
      at("assistant.usage", { model: "auto", inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, initiator: "sub-agent", premiumRequests: 0, agentId: "sub-1" }),
    ]);
    expect(drafts[1]?.payload).toMatchObject({ agent: "bulk-reader", agentInstanceId: "sub-1", initiator: "sub-agent", premiumRequests: 0 });
  });
});
