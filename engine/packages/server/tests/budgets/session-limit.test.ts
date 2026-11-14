import { afterEach, describe, expect, it } from "vitest";
import { call, received, subscribe, waitForEvent } from "../sessions/helpers.ts";
import type { WireEvent } from "../sessions/helpers.ts";
import { createSessionWith, oneCreditCall, pricedScenario, sessionState, startBudgetEngine } from "./helpers.ts";
import type { BudgetEngine } from "./helpers.ts";

let running: BudgetEngine | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

// Each usage step is one model call costing 1 credit; the session limit is 2 credits.
const crossingTurn = {
  steps: [
    oneCreditCall,
    { type: "text", content: "first" },
    oneCreditCall,
    { type: "text", content: "after the limit" },
    oneCreditCall,
    { type: "text", content: "done" },
  ],
};

function summarize(events: readonly WireEvent[]): string[] {
  return events
    .filter((event) => ["usage.recorded", "budget.warning", "budget.exhausted", "assistant.message", "approval.requested"].includes(event.type))
    .map((event) => (event.type === "assistant.message" ? `message:${String(event.payload["text"])}` : event.type));
}

describe("session budget", () => {
  it("passes the limit to the runtime as maxAiCredits", async () => {
    running = await startBudgetEngine(pricedScenario([]), { sessionCredits: 300 });
    const explicit = await createSessionWith(running.client, { budgetCredits: 12 });
    const defaulted = await createSessionWith(running.client);
    expect(explicit["budgetCredits"]).toBe(12);
    expect(defaulted["budgetCredits"]).toBe(300);
  });

  it("blocks the next model call once the limit is crossed and emits budget.exhausted", async () => {
    running = await startBudgetEngine(pricedScenario([crossingTurn]), {});
    const { client } = running;
    const session = await createSessionWith(client, { budgetCredits: 2 });
    const sessionId = session["id"] as string;
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "go", mode: "send" });

    const exhausted = await waitForEvent(client, subscriptionId, (event) => event.type === "budget.exhausted");
    expect(exhausted.payload).toMatchObject({ spentCredits: 2, limitCredits: 2 });

    // A further round trip gives a runtime that was not blocked time to play the rest of the turn.
    const approvals = (await call(client, "approval.list", { sessionId }))["approvals"] as unknown[];
    expect(approvals).toEqual([
      {
        id: exhausted.payload["approvalId"],
        sessionId,
        kind: "budget",
        toolCallId: null,
        summary: "Session budget of 2 credits is used up",
      },
    ]);
    expect((await sessionState(client, sessionId))["state"]).toBe("awaiting_approval");
    expect(summarize(received(client, subscriptionId))).toEqual([
      "usage.recorded",
      "message:first",
      "usage.recorded",
      "budget.warning",
      "approval.requested",
      "budget.exhausted",
    ]);
    const runtimeTypes = running.runtime.eventLog().map((event) => event.type);
    expect(runtimeTypes.filter((type) => type === "assistant.usage")).toHaveLength(2);
    expect(runtimeTypes.at(-1)).toBe("session_limits_exhausted.requested");
  });

  it("warns once per crossing as spend approaches the limit", async () => {
    const turn = { steps: [oneCreditCall, oneCreditCall, oneCreditCall, oneCreditCall] };
    running = await startBudgetEngine(pricedScenario([turn]), { warningThresholds: [0.25, 0.3, 0.375, 0.5] });
    const { client } = running;
    const sessionId = (await createSessionWith(client, { budgetCredits: 8, prompt: "go" }))["id"] as string;
    const subscriptionId = await subscribe(client, sessionId);
    await waitForEvent(client, subscriptionId, (event) => event.type === "session.state_changed" && event.payload["from"] === "running");
    const warnings = received(client, subscriptionId).filter((event) => event.type === "budget.warning");
    // The third call crosses two thresholds and warns once.
    expect(warnings.map((event) => event.payload)).toEqual([
      { spentCredits: 2, limitCredits: 8 },
      { spentCredits: 3, limitCredits: 8 },
      { spentCredits: 4, limitCredits: 8 },
    ]);
  });
});
