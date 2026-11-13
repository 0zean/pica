import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntime, RuntimeHooks, RuntimeSession } from "@pica/core";
import { FakeRuntime } from "@pica/testkit";
import { call, createSession, isState, received, scenario, startSessionEngine, subscribe, waitForEvent } from "./helpers.ts";
import type { SessionEngine } from "./helpers.ts";

let engine: SessionEngine | undefined;

afterEach(async () => {
  await engine?.stop();
  engine = undefined;
});

interface PermissionCall {
  readonly requestId: string;
  readonly approved: boolean;
}

// Records every `resolvePermission` that reaches the runtime.
function spyOnPermissions(runtime: AgentRuntime): { readonly runtime: AgentRuntime; readonly calls: PermissionCall[] } {
  const calls: PermissionCall[] = [];
  const wrap = (session: RuntimeSession): RuntimeSession => ({
    id: session.id,
    subscribe: (listener) => session.subscribe(listener),
    send: (prompt) => session.send(prompt),
    abort: () => session.abort(),
    resolvePermission: (requestId, approved) => {
      calls.push({ requestId, approved });
      return session.resolvePermission(requestId, approved);
    },
    usage: () => session.usage(),
    close: () => session.close(),
  });
  return {
    calls,
    runtime: {
      listModels: () => runtime.listModels(),
      quota: () => runtime.quota(),
      createSession: async (options) => {
        const created = await runtime.createSession(options);
        return created.ok ? { ok: true, value: wrap(created.value) } : created;
      },
      resumeSession: async (options) => {
        const resumed = await runtime.resumeSession(options);
        return resumed.ok ? { ok: true, value: wrap(resumed.value) } : resumed;
      },
    },
  };
}

const askForEdits = (): RuntimeHooks => ({
  onPreToolUse: (input) =>
    Promise.resolve(input.toolName === "edit" ? { decision: "ask", reason: "edit README.md" } : { decision: "allow" }),
});

const editTurn = {
  steps: [
    { type: "toolCall", name: "edit", arguments: { path: "README.md" }, result: "edited" },
    { type: "text", content: "Done." },
  ],
};

describe("approval round trip", () => {
  it("delivers the request to every client and passes one resolution to the runtime exactly once", async () => {
    const spy = spyOnPermissions(new FakeRuntime({ scenario: scenario([editTurn]) }));
    engine = await startSessionEngine(spy.runtime, askForEdits);
    const first = await engine.connect();
    const second = await engine.connect();
    const sessionId = await createSession(first);
    const firstSubscription = await subscribe(first, sessionId);
    const secondSubscription = await subscribe(second, sessionId);

    await call(first, "session.send", { sessionId, text: "edit the readme", mode: "send" });
    const requested = (event: { type: string }): boolean => event.type === "approval.requested";
    const delivered = await waitForEvent(first, firstSubscription, requested);
    expect(await waitForEvent(second, secondSubscription, requested)).toEqual(delivered);
    expect(delivered.payload).toMatchObject({ sessionId, kind: "tool_call", summary: "edit README.md" });
    await waitForEvent(first, firstSubscription, isState("awaiting_approval"));

    const approvalId = delivered.payload["id"] as string;
    const listed = await call(second, "approval.list", { sessionId });
    expect(listed["approvals"]).toEqual([delivered.payload]);

    const answers = await Promise.all([
      first.request("approval.resolve", { approvalId, choice: "allow_once" }),
      second.request("approval.resolve", { approvalId, choice: "deny" }),
    ]);
    expect(answers.filter((answer) => "result" in answer)).toHaveLength(1);
    expect(answers.filter((answer) => "error" in answer).map((answer) => answer["error"])).toMatchObject([
      { data: { code: "not_found" } },
    ]);
    expect(spy.calls).toEqual([{ requestId: approvalId, approved: true }]);

    await waitForEvent(first, firstSubscription, (event) => event.type === "assistant.message");
    await waitForEvent(first, firstSubscription, isState("idle"));
    const types = received(first, firstSubscription).map((event) => event.type);
    expect(types.filter((type) => type === "approval.resolved")).toHaveLength(1);
    expect(types).toContain("tool.completed");
    expect((await call(first, "approval.list", { sessionId }))["approvals"]).toEqual([]);

    const repeat = await first.request("approval.resolve", { approvalId, choice: "allow_once" });
    expect(repeat["error"]).toMatchObject({ data: { code: "not_found" } });
    expect(spy.calls).toHaveLength(1);
  });

  it("a denial reaches the runtime as not approved and the tool fails", async () => {
    const spy = spyOnPermissions(new FakeRuntime({ scenario: scenario([editTurn]) }));
    engine = await startSessionEngine(spy.runtime, askForEdits);
    const client = await engine.connect();
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);

    await call(client, "session.send", { sessionId, text: "edit the readme", mode: "send" });
    const requested = await waitForEvent(client, subscriptionId, (event) => event.type === "approval.requested");
    await call(client, "approval.resolve", { approvalId: requested.payload["id"], choice: "deny" });
    await waitForEvent(client, subscriptionId, isState("idle"));

    expect(spy.calls).toEqual([{ requestId: requested.payload["id"], approved: false }]);
    const events = received(client, subscriptionId);
    expect(events.find((event) => event.type === "approval.resolved")?.payload).toEqual({
      approvalId: requested.payload["id"],
      choice: "deny",
    });
    expect(events.some((event) => event.type === "tool.failed")).toBe(true);
  });
});
