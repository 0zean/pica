import { afterEach, describe, expect, it } from "vitest";
import { scenarioSchema } from "@pica/testkit";
import { call, isState, received, subscribe, waitForEvent } from "../sessions/helpers.ts";
import { createRequest, createSessionWith, startBudgetEngine } from "./helpers.ts";
import type { BudgetEngine } from "./helpers.ts";

let running: BudgetEngine | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

// A plan like Copilot Free (S-03): one `auto` model with no token prices, each call billed by the
// runtime, and no session limit under 30 credits accepted.
const billedCall = { type: "usage", model: "auto", inputTokens: 1000, outputTokens: 10, billedCredits: 0.4 };
const freePlan = (turns: unknown[]) =>
  scenarioSchema.parse({ version: 1, models: [{ id: "auto", name: "Auto" }], defaultModel: "auto", turns });
const runtimeFloor = 30;

describe("plans without token prices (S-03)", () => {
  it("records the billed credits in the ledger and on the timeline", async () => {
    running = await startBudgetEngine(freePlan([{ steps: [billedCall, billedCall] }]), {}, runtimeFloor);
    const { client } = running;
    const sessionId = (await createSessionWith(client, { prompt: "go" }))["id"] as string;
    const subscriptionId = await subscribe(client, sessionId);
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");

    const recorded = received(client, subscriptionId).filter((event) => event.type === "usage.recorded");
    expect(recorded.map((event) => event.payload["credits"])).toEqual([0.4, 0.4]);
    const rollup = await call(client, "usage.rollup", { groupBy: "session", sessionId });
    expect(rollup["rows"]).toMatchObject([{ credits: 0.8 }]);
  });

  it("accepts a session limit below the runtime's floor and enforces it in the engine", async () => {
    const turn = { steps: [billedCall, { type: "text", content: "first" }, billedCall, billedCall, billedCall, { type: "text", content: "late" }] };
    running = await startBudgetEngine(freePlan([turn, turn]), {}, runtimeFloor);
    const { client } = running;
    const session = await createSessionWith(client, { budgetCredits: 1 });
    const sessionId = session["id"] as string;
    expect(session["budgetCredits"]).toBe(1);
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "go", mode: "send" });

    const aborted = await waitForEvent(client, subscriptionId, (event) => event.type === "session.aborted");
    expect(aborted.payload).toEqual({ reason: "budget" });
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");
    const runtimeTypes = running.runtime.eventLog().map((event) => event.type);
    expect(runtimeTypes).not.toContain("session_limits_exhausted.requested");
    expect(runtimeTypes.filter((type) => type === "assistant.usage")).toHaveLength(3);

    const refused = await client.request("session.send", { sessionId, text: "more", mode: "send" });
    expect(refused["error"]).toMatchObject({ data: { code: "budget_exhausted" } });
  });

  it("still hands the runtime a limit at or above its floor", async () => {
    running = await startBudgetEngine(freePlan([]), {}, runtimeFloor);
    const created = await running.client.request("session.create", createRequest({ budgetCredits: runtimeFloor }));
    expect(created["result"]).toBeDefined();
  });
});
