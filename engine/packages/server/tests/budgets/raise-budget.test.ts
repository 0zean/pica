import { afterEach, describe, expect, it } from "vitest";
import type { TestClient } from "../helpers.ts";
import { call, isState, received, subscribe, waitForEvent } from "../sessions/helpers.ts";
import { createSessionWith, oneCreditCall, pricedScenario, sessionState, startBudgetEngine } from "./helpers.ts";
import type { BudgetEngine } from "./helpers.ts";

let running: BudgetEngine | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

const crossingTurn = {
  steps: [oneCreditCall, oneCreditCall, { type: "text", content: "after the limit" }, oneCreditCall, { type: "text", content: "done" }],
};

interface Exhausted {
  readonly sessionId: string;
  readonly subscriptionId: string;
  readonly approvalId: string;
}

async function runUntilExhausted(client: TestClient): Promise<Exhausted> {
  const sessionId = (await createSessionWith(client, { budgetCredits: 2 }))["id"] as string;
  const subscriptionId = await subscribe(client, sessionId);
  await call(client, "session.send", { sessionId, text: "go", mode: "send" });
  const exhausted = await waitForEvent(client, subscriptionId, (event) => event.type === "budget.exhausted");
  return { sessionId, subscriptionId, approvalId: exhausted.payload["approvalId"] as string };
}

function messages(client: TestClient, subscriptionId: string): string[] {
  return received(client, subscriptionId)
    .filter((event) => event.type === "assistant.message")
    .map((event) => event.payload["text"] as string);
}

describe("raising the budget through the approval", () => {
  it("resumes the run under the new limit", async () => {
    running = await startBudgetEngine(pricedScenario([crossingTurn]), {});
    const { client } = running;
    const { sessionId, subscriptionId, approvalId } = await runUntilExhausted(client);

    await call(client, "approval.resolve", { approvalId, choice: "allow_once", budgetCredits: 5 });
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");

    expect(messages(client, subscriptionId)).toEqual(["after the limit", "done"]);
    expect(received(client, subscriptionId).filter((event) => event.type === "approval.resolved").map((event) => event.payload)).toEqual([
      { approvalId, choice: "allow_once" },
    ]);
    expect(received(client, subscriptionId).some((event) => event.type === "session.aborted")).toBe(false);
    const session = await sessionState(client, sessionId);
    expect(session).toMatchObject({ state: "idle", budgetCredits: 5 });
    expect(running.store.sessions.get(sessionId)).toMatchObject({ ok: true, value: { budgetMaxCredits: 5 } });
  });

  it("raises by the configured session budget when no amount is given", async () => {
    running = await startBudgetEngine(pricedScenario([crossingTurn]), { sessionCredits: 2 });
    const { client } = running;
    const { sessionId, subscriptionId, approvalId } = await runUntilExhausted(client);

    await call(client, "approval.resolve", { approvalId, choice: "allow_once" });
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");

    expect(messages(client, subscriptionId)).toEqual(["after the limit", "done"]);
    expect((await sessionState(client, sessionId))["budgetCredits"]).toBe(4);
  });

  it("refuses a new budget that does not exceed what was spent and keeps the approval", async () => {
    running = await startBudgetEngine(pricedScenario([crossingTurn]), {});
    const { client } = running;
    const { sessionId, approvalId } = await runUntilExhausted(client);

    const refused = await client.request("approval.resolve", { approvalId, choice: "allow_once", budgetCredits: 2 });
    expect(refused["error"]).toMatchObject({ data: { code: "invalid_params" } });
    expect((await call(client, "approval.list", { sessionId }))["approvals"]).toHaveLength(1);
    expect((await sessionState(client, sessionId))["state"]).toBe("awaiting_approval");
  });

  it("ends the turn when the approval is denied", async () => {
    running = await startBudgetEngine(pricedScenario([crossingTurn]), {});
    const { client } = running;
    const { sessionId, subscriptionId, approvalId } = await runUntilExhausted(client);

    await call(client, "approval.resolve", { approvalId, choice: "deny" });
    await waitForEvent(client, subscriptionId, (event) => isState("idle")(event) && event.payload["from"] === "running");

    expect(messages(client, subscriptionId)).toEqual([]);
    expect(received(client, subscriptionId).filter((event) => event.type === "session.aborted").map((event) => event.payload)).toEqual([
      { reason: "budget" },
    ]);
    expect((await sessionState(client, sessionId))["budgetCredits"]).toBe(2);
  });
});
