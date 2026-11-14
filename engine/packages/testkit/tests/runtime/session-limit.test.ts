import { describe, expect, it } from "vitest";
import type { RuntimeEvent, RuntimeSession } from "@pica/core";
import { FakeRuntime, scenarioSchema } from "../../src/index.ts";

// 100 credits per million input tokens: each usage step costs 1 credit.
const scenario = scenarioSchema.parse({
  version: 1,
  models: [{ id: "m", name: "M", tokenPrices: { input: 100, cachedInput: 0, output: 0 } }],
  defaultModel: "m",
  turns: [
    {
      steps: [
        { type: "usage", model: "m", inputTokens: 10_000, outputTokens: 0 },
        { type: "usage", model: "m", inputTokens: 10_000, outputTokens: 0 },
        { type: "text", content: "after" },
      ],
    },
  ],
});

async function open(maxAiCredits?: number): Promise<{ session: RuntimeSession; events: RuntimeEvent[] }> {
  const created = await new FakeRuntime({ scenario }).createSession({
    workingDirectory: "/repo",
    ...(maxAiCredits === undefined ? {} : { maxAiCredits }),
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  const events: RuntimeEvent[] = [];
  created.value.subscribe((event) => events.push(event));
  return { session: created.value, events };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function limitRequest(events: readonly RuntimeEvent[]): Extract<RuntimeEvent, { type: "session_limits_exhausted.requested" }> {
  const found = events.find((event) => event.type === "session_limits_exhausted.requested");
  if (found?.type !== "session_limits_exhausted.requested") {
    throw new Error("no session limit request");
  }
  return found;
}

describe("FakeRuntime maxAiCredits", () => {
  it("runs the whole turn without a limit", async () => {
    const { session, events } = await open();
    await session.send("go");
    await settle();
    expect(events.map((event) => event.type)).toContain("session.idle");
    expect(events.some((event) => event.type === "session_limits_exhausted.requested")).toBe(false);
  });

  it("holds the next call once the limit is reached and continues when it is raised", async () => {
    const { session, events } = await open(2);
    await session.send("go");
    await settle();
    const request = limitRequest(events);
    expect(request.data).toMatchObject({ usedAiCredits: 2, maxAiCredits: 2 });
    expect(events.at(-1)?.type).toBe("session_limits_exhausted.requested");

    const tooLow = await session.resolveSessionLimit(request.data.requestId, 2);
    expect(tooLow.ok ? undefined : tooLow.error.code).toBe("runtime.invalid_argument");
    expect((await session.resolveSessionLimit(request.data.requestId, 3)).ok).toBe(true);
    await settle();
    expect(events.slice(events.indexOf(request) + 1).map((event) => event.type)).toEqual([
      "session_limits_exhausted.completed",
      "assistant.message",
      "assistant.turn_end",
      "session.idle",
    ]);
    const again = await session.resolveSessionLimit(request.data.requestId, 4);
    expect(again.ok ? undefined : again.error.code).toBe("runtime.limit_request_not_found");
  });

  it("ends the turn when the request is cancelled", async () => {
    const { session, events } = await open(2);
    await session.send("go");
    await settle();
    const request = limitRequest(events);
    await session.resolveSessionLimit(request.data.requestId, null);
    await settle();
    expect(events.slice(events.indexOf(request) + 1).map((event) => event.type)).toEqual([
      "session_limits_exhausted.completed",
      "assistant.turn_end",
      "session.idle",
    ]);
  });
});
