import { compileManagedPolicy, managedBudgetSettings } from "@pica/core";
import { afterEach, describe, expect, it } from "vitest";
import { call, subscribe, waitForEvent } from "../sessions/helpers.ts";
import { createSessionWith, oneCreditCall, pricedScenario, sessionState, startBudgetEngine } from "./helpers.ts";
import type { BudgetEngine } from "./helpers.ts";

let running: BudgetEngine | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

const policy = compileManagedPolicy("policy.jsonc", { budget: { maxSessionCredits: 3 } });
if (!policy.ok) {
  throw new Error(policy.error.message);
}
const ceilingBudget = managedBudgetSettings({ sessionCredits: 300 }, policy.value);

describe("managed session budget ceiling", () => {
  it("caps the configured budget for a session created without one", async () => {
    running = await startBudgetEngine(pricedScenario([]), ceilingBudget);
    const session = await createSessionWith(running.client);
    expect((await sessionState(running.client, session["id"] as string))["budgetCredits"]).toBe(3);
  });

  it("caps a budget the client asks for", async () => {
    running = await startBudgetEngine(pricedScenario([]), ceilingBudget);
    const session = await createSessionWith(running.client, { budgetCredits: 1000 });
    expect((await sessionState(running.client, session["id"] as string))["budgetCredits"]).toBe(3);
  });

  it("caps a raise approved after the budget runs out", async () => {
    const turn = { steps: [oneCreditCall, oneCreditCall, oneCreditCall, { type: "text", content: "done" }] };
    running = await startBudgetEngine(pricedScenario([turn]), ceilingBudget);
    const { client } = running;
    const sessionId = (await createSessionWith(client, { budgetCredits: 2 }))["id"] as string;
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "go", mode: "send" });
    const exhausted = await waitForEvent(client, subscriptionId, (event) => event.type === "budget.exhausted");

    await call(client, "approval.resolve", { approvalId: exhausted.payload["approvalId"], choice: "allow_once", budgetCredits: 1000 });

    expect((await sessionState(client, sessionId))["budgetCredits"]).toBe(3);
    expect(running.store.sessions.get(sessionId)).toMatchObject({ ok: true, value: { budgetMaxCredits: 3 } });
  });
});
