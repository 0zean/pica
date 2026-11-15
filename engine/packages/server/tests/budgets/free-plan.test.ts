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

  it("offers a budget approval that raises an engine-enforced limit", async () => {
    const turn = { steps: [billedCall, billedCall, billedCall, { type: "text", content: "late" }] };
    const after = { steps: [billedCall, { type: "text", content: "after raise" }] };
    running = await startBudgetEngine(freePlan([turn, after]), {}, runtimeFloor);
    const { client } = running;
    const sessionId = (await createSessionWith(client, { budgetCredits: 1 }))["id"] as string;
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "go", mode: "send" });

    const exhausted = await waitForEvent(client, subscriptionId, (event) => event.type === "budget.exhausted");
    expect(exhausted.payload).toMatchObject({ limitCredits: 1 });
    const approvalId = exhausted.payload["approvalId"] as string;
    const approvals = (await call(client, "approval.list", { sessionId }))["approvals"];
    expect(approvals).toMatchObject([{ id: approvalId, kind: "budget" }]);
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");
    const refused = await client.request("session.send", { sessionId, text: "more", mode: "send" });
    expect(String((refused["error"] as Record<string, unknown>)["message"])).toContain(approvalId);

    await call(client, "approval.resolve", { approvalId, choice: "allow_once", budgetCredits: 3 });
    expect((await call(client, "session.get", { sessionId }))["session"]).toMatchObject({ budgetCredits: 3 });
    expect(await call(client, "session.send", { sessionId, text: "more", mode: "send" })).toEqual({ accepted: true });
    await waitForEvent(client, subscriptionId, (event) => event.type === "assistant.message" && event.payload["text"] === "after raise");
    const runtimeTypes = running.runtime.eventLog().map((event) => event.type);
    expect(runtimeTypes).not.toContain("session_limits_exhausted.completed");
  });

  it("keeps the session stopped when the budget approval is denied", async () => {
    const turn = { steps: [billedCall, billedCall, billedCall] };
    running = await startBudgetEngine(freePlan([turn]), {}, runtimeFloor);
    const { client } = running;
    const sessionId = (await createSessionWith(client, { budgetCredits: 1 }))["id"] as string;
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "go", mode: "send" });
    const exhausted = await waitForEvent(client, subscriptionId, (event) => event.type === "budget.exhausted");
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");

    await call(client, "approval.resolve", { approvalId: exhausted.payload["approvalId"], choice: "deny" });
    expect((await call(client, "approval.list", { sessionId }))["approvals"]).toEqual([]);
    const aborts = received(client, subscriptionId).filter((event) => event.type === "session.aborted");
    expect(aborts).toHaveLength(1);
    const refused = await client.request("session.send", { sessionId, text: "more", mode: "send" });
    expect(refused["error"]).toMatchObject({ data: { code: "budget_exhausted" } });
  });

  it("offers the approval again when a session resumes with its budget used up", async () => {
    running = await startBudgetEngine(freePlan([{ steps: [billedCall, billedCall, billedCall] }]), {}, runtimeFloor);
    const { client, store } = running;
    const sessionId = (await createSessionWith(client, { budgetCredits: 1 }))["id"] as string;
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "go", mode: "send" });
    const first = await waitForEvent(client, subscriptionId, (event) => event.type === "budget.exhausted");
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");

    store.sessions.updateState(sessionId, "resumable", "2026-11-13T10:00:00.000Z");
    await call(client, "session.resume", { sessionId });
    const approvals = (await call(client, "approval.list", { sessionId }))["approvals"] as { id: string }[];
    expect(approvals).toMatchObject([{ kind: "budget" }]);
    expect(approvals[0]?.id).not.toBe(first.payload["approvalId"]);
  });

  it("lets the runtime's credit total catch up a budget the ledger could not price (S-01)", async () => {
    // No billed credits and no prices: the ledger records 0 credits, but the runtime billed 2.
    const unbilled = { type: "usage", model: "auto", inputTokens: 1000, outputTokens: 10 };
    const turn = { steps: [unbilled, unbilled, { type: "usageCheckpoint", billedCredits: 2 }, { type: "text", content: "late" }] };
    running = await startBudgetEngine(freePlan([turn]), {}, runtimeFloor);
    const { client } = running;
    const sessionId = (await createSessionWith(client, { budgetCredits: 1 }))["id"] as string;
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "go", mode: "send" });

    const aborted = await waitForEvent(client, subscriptionId, (event) => event.type === "session.aborted");
    expect(aborted.payload).toEqual({ reason: "budget" });
    const rollup = await call(client, "usage.rollup", { groupBy: "session", sessionId });
    expect(rollup["rows"]).toMatchObject([{ calls: 2, credits: 0 }]);
  });

  it("changes nothing when the runtime's total matches the ledger", async () => {
    const turn = { steps: [billedCall, billedCall, { type: "usageCheckpoint", billedCredits: 0.8 }, { type: "text", content: "done" }] };
    running = await startBudgetEngine(freePlan([turn]), {}, runtimeFloor);
    const { client } = running;
    const sessionId = (await createSessionWith(client, { budgetCredits: 1 }))["id"] as string;
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "go", mode: "send" });
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");
    const types = received(client, subscriptionId).map((event) => event.type);
    expect(types).not.toContain("session.aborted");
    expect(types.filter((type) => type === "budget.warning")).toHaveLength(1);
  });

  it("still hands the runtime a limit at or above its floor", async () => {
    running = await startBudgetEngine(freePlan([]), {}, runtimeFloor);
    const created = await running.client.request("session.create", createRequest({ budgetCredits: runtimeFloor }));
    expect(created["result"]).toBeDefined();
  });
});
