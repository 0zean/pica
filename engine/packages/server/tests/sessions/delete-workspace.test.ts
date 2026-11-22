import { createWorkspaceService, defaultDiscoveryFilter, err, repoRegistryError } from "@pica/core";
import type { Store } from "@pica/core";
import { FakeRuntime } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { call, createSession, isState, scenario, startSessionEngine, subscribe, waitForEvent, workspaceId } from "./helpers.ts";
import type { SessionEngine } from "./helpers.ts";

let engine: SessionEngine | undefined;

afterEach(async () => {
  await engine?.stop();
  engine = undefined;
});

function workspaces(store: Store): ReturnType<typeof createWorkspaceService> {
  return createWorkspaceService({
    workspaces: store.workspaces,
    repos: store.repos,
    discovery: {
      client: () => Promise.reject(new Error("this test does not discover")),
      filter: defaultDiscoveryFilter,
    },
    clone: () => Promise.resolve(err(repoRegistryError("repo.clone_failed", "not in this test"))),
    newId: () => "unused",
    clock: () => "2026-11-13T09:00:00.000Z",
  });
}

describe("workspace.delete with sessions", () => {
  it("refuses while a session is working, then ends the idle session and deletes the workspace", async () => {
    const runtime = new FakeRuntime({
      scenario: scenario([
        { steps: [{ type: "toolCall", name: "shell", arguments: { command: "make test" }, result: "", hangs: true }] },
      ]),
    });
    engine = await startSessionEngine(runtime, undefined, workspaces);
    const client = await engine.connect();
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "run the tests", mode: "send" });
    await waitForEvent(client, subscriptionId, (event) => event.type === "tool.started");

    const refused = await client.request("workspace.delete", { id: workspaceId });
    expect(refused["error"]).toMatchObject({
      data: { code: "invalid_state", details: { reason: "workspace.sessions_busy", sessionIds: [sessionId] } },
    });

    await call(client, "session.abort", { sessionId });
    await waitForEvent(client, subscriptionId, isState("idle"));
    expect(await call(client, "workspace.delete", { id: workspaceId })).toEqual({ ok: true });

    const states = client
      .notifications()
      .filter((message) => message["method"] === "session.changed")
      .map((message) => (message["params"] as { session: { state: string } }).session.state);
    expect(states.at(-1)).toBe("ended");
    expect(client.notifications().filter((message) => message["method"] === "workspace.deleted").map((message) => message["params"])).toEqual([
      { id: workspaceId },
    ]);
    const gone = await client.request("session.get", { sessionId });
    expect(gone["error"]).toMatchObject({ data: { code: "not_found" } });
  });

  it("deletes a workspace whose sessions were deleted, and their kept usage with it", async () => {
    engine = await startSessionEngine(new FakeRuntime({ scenario: scenario([]) }), undefined, workspaces);
    const client = await engine.connect();
    const sessionId = await createSession(client);
    await waitForEvent(client, await subscribe(client, sessionId), isState("idle"));
    await call(client, "session.delete", { sessionId });

    await call(client, "workspace.delete", { id: workspaceId });
    const rollup = await call(client, "usage.rollup", { groupBy: "session" });
    expect(rollup["rows"]).toEqual([]);
  });
});
