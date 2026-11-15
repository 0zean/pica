import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtinDelegator, fakeRuntime, openHarness, payload, runTurn, sessionEvents, sessionService, startSession } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

// C-07 check 1: a delegation's child events nest under the parent's `task` call.

let harness: Harness;
beforeEach(() => {
  harness = openHarness();
});
afterEach(() => {
  harness.close();
});

const delegation = {
  type: "subagent",
  agentName: "bulk-reader",
  model: "model-a",
  viaTask: true,
  steps: [
    { type: "toolCall", name: "view", arguments: { path: "schema.sql", view_range: [1, 40] }, result: "-- schema" },
    { type: "usage", model: "model-a", inputTokens: 900, outputTokens: 40 },
    { type: "text", content: "The schema has 3 tables (schema.sql:1-40)." },
  ],
};

describe("C-07 delegation nesting (FakeRuntime)", () => {
  it("nests the child's events under the parent's task call", async () => {
    const sessions = sessionService(harness, fakeRuntime([{ steps: [delegation, { type: "text", content: "3 tables." }] }]), builtinDelegator());
    const sessionId = await startSession(sessions);
    await runTurn(harness, sessions, sessionId, "how many tables?");

    const events = sessionEvents(harness, sessionId);
    const task = events.find((event) => event.type === "tool.started" && payload(event).toolName === "task");
    expect(payload(task)).toMatchObject({ agent: "main", parentToolCallId: null, arguments: { agent_type: "bulk-reader" } });
    const taskId = payload(task).toolCallId;

    const taskEnd = events.findIndex((event) => event.type === "tool.completed" && payload(event).toolCallId === taskId);
    const start = task === undefined ? -1 : events.indexOf(task);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(taskEnd).toBeGreaterThan(start);
    const inside = events.slice(start + 1, taskEnd);
    expect(inside.map((event) => event.type)).toEqual([
      "subagent.started",
      "tool.started",
      "tool.completed",
      "usage.recorded",
      "assistant.message",
      "subagent.completed",
    ]);
    expect(payload(inside[0])).toMatchObject({ toolCallId: taskId, agent: "bulk-reader" });
    for (const event of inside.filter((entry) => entry.type.startsWith("tool."))) {
      expect(payload(event)).toMatchObject({ agent: "bulk-reader", parentToolCallId: taskId });
    }
    expect(payload(inside[3])).toMatchObject({ agent: "bulk-reader" });
    expect(payload(inside[4])).toMatchObject({ agent: "bulk-reader" });
    expect(payload(inside[5])).toMatchObject({ toolCallId: taskId, agent: "bulk-reader" });
    expect(payload(events[taskEnd])).toMatchObject({ agent: "main", parentToolCallId: null });

    const after = events.slice(taskEnd + 1).find((event) => event.type === "assistant.message");
    expect(payload(after)).toMatchObject({ agent: "main", text: "3 tables." });
  });
});
