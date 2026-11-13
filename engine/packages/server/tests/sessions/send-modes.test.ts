import { afterEach, describe, expect, it } from "vitest";
import { FakeRuntime } from "@pica/testkit";
import { call, createSession, received, scenario, startSessionEngine, subscribe, waitForEvent } from "./helpers.ts";
import type { SessionEngine, WireEvent } from "./helpers.ts";

let engine: SessionEngine | undefined;

afterEach(async () => {
  await engine?.stop();
  engine = undefined;
});

const hangingTurn = {
  steps: [{ type: "toolCall", name: "shell", arguments: { command: "sleep" }, result: "", hangs: true }],
};

function textTurn(prompt: string, content: string): unknown {
  return { prompt, steps: [{ type: "text", content }] };
}

function messages(events: readonly WireEvent[]): unknown[] {
  return events
    .filter((event) => event.type === "user.message" || event.type === "assistant.message")
    .map((event) => [event.type, event.payload["mode"] ?? null, event.payload["text"]]);
}

describe("session.send modes", () => {
  it("queues behind the running turn, refuses a plain send, and steer replaces the running turn", async () => {
    const runtime = new FakeRuntime({
      scenario: scenario([hangingTurn, textTurn("use the fixture", "Using the fixture."), textTurn("then lint", "Linted.")]),
    });
    engine = await startSessionEngine(runtime);
    const client = await engine.connect();
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);

    await call(client, "session.send", { sessionId, text: "run it", mode: "send" });
    await waitForEvent(client, subscriptionId, (event) => event.type === "tool.started");

    expect(await call(client, "session.send", { sessionId, text: "again", mode: "send" })).toEqual({ accepted: false });
    expect(await call(client, "session.send", { sessionId, text: "then lint", mode: "queue" })).toEqual({ accepted: true });
    expect(await call(client, "session.send", { sessionId, text: "use the fixture", mode: "steer" })).toEqual({ accepted: true });

    await waitForEvent(client, subscriptionId, (event) => event.type === "assistant.message" && event.payload["text"] === "Linted.");
    await client.waitFor(() => {
      const events = received(client, subscriptionId);
      return events.at(-1)?.type === "session.state_changed" && events.at(-1)?.payload["to"] === "idle";
    });

    const events = received(client, subscriptionId);
    expect(messages(events)).toEqual([
      ["user.message", "send", "run it"],
      ["user.message", "queue", "then lint"],
      ["user.message", "steer", "use the fixture"],
      ["assistant.message", null, "Using the fixture."],
      ["assistant.message", null, "Linted."],
    ]);
    expect(events.filter((event) => event.type === "session.aborted").map((event) => event.payload)).toEqual([
      { reason: "user" },
    ]);
  });

  it("refuses to send to a session that is not live", async () => {
    engine = await startSessionEngine(new FakeRuntime({ scenario: scenario([]) }));
    const client = await engine.connect();
    const sessionId = await createSession(client);
    await call(client, "session.end", { sessionId });

    const refused = await client.request("session.send", { sessionId, text: "hello", mode: "send" });
    expect(refused["error"]).toMatchObject({ data: { code: "invalid_state" } });
    const resumed = await client.request("session.resume", { sessionId });
    expect(resumed["error"]).toMatchObject({ data: { code: "invalid_state" } });
    const missing = await client.request("session.get", { sessionId: "no-such-session" });
    expect(missing["error"]).toMatchObject({ data: { code: "not_found" } });
  });
});
