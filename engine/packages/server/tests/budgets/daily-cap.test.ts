import { afterEach, describe, expect, it } from "vitest";
import type { Store } from "@pica/core";
import { isState, subscribe, waitForEvent, workspaceId } from "../sessions/helpers.ts";
import { createRequest, createSessionWith, oneCreditCall, pricedScenario, startBudgetEngine } from "./helpers.ts";
import type { BudgetEngine } from "./helpers.ts";

let running: BudgetEngine | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

// The engine clock starts at 2026-11-13T09:00Z, so the cap resets at the next UTC midnight.
const resetAt = "2026-11-14T00:00:00.000Z";

function recordSpend(store: Store, sessionId: string, credits: number, timestamp: string): void {
  store.sessions.create({
    id: sessionId,
    workspaceId,
    writeRoots: [],
    referenceRoots: [],
    state: "ended",
    routingProfile: "balanced",
    budgetMaxCredits: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const recorded = store.usage.record({
    sessionId,
    agent: "main",
    model: "model-a",
    inputTokens: 1,
    cachedTokens: 0,
    outputTokens: 0,
    credits,
    tier: null,
    timestamp,
  });
  if (!recorded.ok) {
    throw new Error(recorded.error.message);
  }
}

describe("workspace daily cap", () => {
  it("blocks a new session once the workspace has spent its daily credits and reports the reset time", async () => {
    const turn = { steps: [oneCreditCall, oneCreditCall, oneCreditCall] };
    running = await startBudgetEngine(pricedScenario([turn]), { workspaceDailyCredits: 3 });
    const { client } = running;
    const first = (await createSessionWith(client, { prompt: "go" }))["id"] as string;
    const subscriptionId = await subscribe(client, first);
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");

    const refused = await client.request("session.create", createRequest());
    expect(refused["error"]).toMatchObject({
      data: { code: "budget_exhausted", details: { reason: "session.budget_exhausted", resetAt } },
    });
    expect(String((refused["error"] as Record<string, unknown>)["message"])).toContain(resetAt);
    expect(running.store.sessions.listByWorkspace(workspaceId)).toMatchObject({ ok: true, value: [{ id: first }] });
  });

  it("counts only today's spend", async () => {
    running = await startBudgetEngine(pricedScenario([]), { workspaceDailyCredits: 3 });
    recordSpend(running.store, "yesterday", 50, "2026-11-12T23:59:59.000Z");
    recordSpend(running.store, "today", 2.5, "2026-11-13T00:00:00.000Z");
    const created = await running.client.request("session.create", createRequest());
    expect(created["result"]).toBeDefined();
  });

  it("blocks resuming a session while the cap is spent", async () => {
    running = await startBudgetEngine(pricedScenario([]), { workspaceDailyCredits: 3 });
    const sessionId = (await createSessionWith(running.client))["id"] as string;
    running.store.sessions.updateState(sessionId, "resumable", "2026-11-13T09:30:00.000Z");
    recordSpend(running.store, "earlier", 3, "2026-11-13T08:00:00.000Z");
    const refused = await running.client.request("session.resume", { sessionId });
    expect(refused["error"]).toMatchObject({ data: { code: "budget_exhausted", details: { resetAt } } });
  });
});
