import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtinDelegator, fakeRuntime, openHarness, payload, runTurn, sessionEvents, sessionService, startSession } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

// C-07 check 2: a failing child emits a failure event and the parent run continues.

let harness: Harness;
beforeEach(() => {
  harness = openHarness();
});
afterEach(() => {
  harness.close();
});

const failing = {
  type: "subagent",
  agentName: "bulk-reader",
  model: "model-a",
  viaTask: true,
  steps: [{ type: "toolCall", name: "view", arguments: { path: "missing.txt" }, result: "no such file", success: false }],
  failure: "bulk-reader could not read missing.txt",
};

describe("C-07 failing delegation (FakeRuntime)", () => {
  it("emits subagent.failed, fails the task call, and lets the parent continue", async () => {
    const turns = [
      { steps: [failing, { type: "toolCall", name: "glob", arguments: { pattern: "*.txt" }, result: "notes.txt" }, { type: "text", content: "missing.txt does not exist." }] },
      { steps: [{ type: "text", content: "Still here." }] },
    ];
    const sessions = sessionService(harness, fakeRuntime(turns), builtinDelegator());
    const sessionId = await startSession(sessions);
    await runTurn(harness, sessions, sessionId, "read missing.txt");

    const events = sessionEvents(harness, sessionId);
    const failed = events.find((event) => event.type === "subagent.failed");
    expect(payload(failed)).toMatchObject({ agent: "bulk-reader", error: "bulk-reader could not read missing.txt" });
    const task = events.find((event) => event.type === "tool.started" && payload(event).toolName === "task");
    const taskFailed = events.find((event) => event.type === "tool.failed" && payload(event).toolCallId === payload(task).toolCallId);
    expect(payload(taskFailed)).toMatchObject({ agent: "main", parentToolCallId: null });
    const failedAt = events.findIndex((event) => event === taskFailed);
    expect(failedAt).toBeGreaterThan(events.findIndex((event) => event === failed));

    // The main agent goes on with its own tool call and answer in the same turn.
    const rest = events.slice(failedAt + 1);
    expect(rest.find((event) => event.type === "tool.completed")).toMatchObject({ payload: { toolName: "glob", agent: "main" } });
    expect(rest.find((event) => event.type === "assistant.message")).toMatchObject({ payload: { agent: "main", text: "missing.txt does not exist." } });
    expect(events.some((event) => event.type === "session.error")).toBe(false);

    // The session is still usable for the next turn.
    await runTurn(harness, sessions, sessionId, "still there?");
    const last = sessionEvents(harness, sessionId).filter((event) => event.type === "assistant.message").at(-1);
    expect(payload(last)).toMatchObject({ agent: "main", text: "Still here." });
  });
});
