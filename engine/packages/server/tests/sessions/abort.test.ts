import { afterEach, describe, expect, it } from "vitest";
import { FakeRuntime } from "@pica/testkit";
import { call, createSession, isState, received, scenario, startSessionEngine, subscribe, waitForEvent } from "./helpers.ts";
import type { SessionEngine } from "./helpers.ts";

let engine: SessionEngine | undefined;

afterEach(async () => {
  await engine?.stop();
  engine = undefined;
});

describe("session.abort", () => {
  it("aborting during a tool call ends in idle with an aborted event", async () => {
    const runtime = new FakeRuntime({
      scenario: scenario([
        {
          steps: [
            { type: "text", content: "Running the tests." },
            { type: "toolCall", name: "shell", arguments: { command: "make test" }, result: "", hangs: true },
          ],
        },
        { steps: [{ type: "text", content: "Still here." }] },
      ]),
    });
    engine = await startSessionEngine(runtime);
    const client = await engine.connect();
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);

    await call(client, "session.send", { sessionId, text: "run the tests", mode: "send" });
    await waitForEvent(client, subscriptionId, (event) => event.type === "tool.started");
    await call(client, "session.abort", { sessionId });
    await waitForEvent(client, subscriptionId, isState("idle"));

    const tail = received(client, subscriptionId).map((event) => [
      event.type,
      event.payload["to"] ?? event.payload["reason"] ?? event.payload["toolName"] ?? null,
    ]);
    expect(tail.slice(-4)).toEqual([
      ["tool.started", "shell"],
      ["tool.failed", "shell"],
      ["session.aborted", "user"],
      ["session.state_changed", "idle"],
    ]);
    const session = await call(client, "session.get", { sessionId });
    expect((session["session"] as { state: string }).state).toBe("idle");

    // The session takes the next turn normally.
    await call(client, "session.send", { sessionId, text: "carry on", mode: "send" });
    await waitForEvent(client, subscriptionId, (event) => event.type === "assistant.message" && event.payload["text"] === "Still here.");
  });

  it("is a no-op on an idle session", async () => {
    engine = await startSessionEngine(new FakeRuntime({ scenario: scenario([]) }));
    const client = await engine.connect();
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);
    await waitForEvent(client, subscriptionId, isState("idle"));

    await call(client, "session.abort", { sessionId });
    const session = await call(client, "session.get", { sessionId });
    expect((session["session"] as { state: string }).state).toBe("idle");
    expect(received(client, subscriptionId).some((event) => event.type === "session.aborted")).toBe(false);
  });
});
