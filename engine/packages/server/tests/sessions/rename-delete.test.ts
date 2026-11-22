import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionArtifacts } from "@pica/adapters";
import { defaultCommandDenyList } from "@pica/core";
import type { SessionArtifacts } from "@pica/core";
import { PicaConfig } from "@pica/protocol";
import { FakeRuntime } from "@pica/testkit";
import type { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";
import { call, createSession, isState, openSeededStore, scenario, startSessionEngine, subscribe, waitForEvent, workspaceId } from "./helpers.ts";
import type { SessionEngine } from "./helpers.ts";

let engine: SessionEngine | undefined;

afterEach(async () => {
  await engine?.stop();
  engine = undefined;
});

const hangingTurn = {
  steps: [
    { type: "text", content: "Running the tests." },
    { type: "toolCall", name: "shell", arguments: { command: "make test" }, result: "", hangs: true },
  ],
};

interface Started {
  readonly client: TestClient;
  readonly runtime: FakeRuntime;
  readonly artifacts: SessionArtifacts;
}

async function start(turns: unknown[] = []): Promise<Started> {
  const runtime = new FakeRuntime({ scenario: scenario(turns) });
  let artifacts: SessionArtifacts | undefined;
  engine = await startSessionEngine(runtime, undefined, (dir) => {
    artifacts = createSessionArtifacts(join(dir, "sessions"));
    return {
      outputGuard: {
        artifacts,
        policyContext: () => ({
          cwd: "/src/acme/api",
          writeRoots: ["/src/acme/api"],
          referenceRoots: [],
          config: PicaConfig.parse({}),
          managed: [],
          commandDenyList: defaultCommandDenyList,
        }),
      },
    };
  });
  if (artifacts === undefined) throw new Error("no artifacts");
  return { client: await engine.connect(), runtime, artifacts };
}

async function idleSession(client: TestClient): Promise<string> {
  const sessionId = await createSession(client);
  const subscriptionId = await subscribe(client, sessionId);
  await waitForEvent(client, subscriptionId, isState("idle"));
  return sessionId;
}

function sessionOf(result: JsonObject): JsonObject {
  return result["session"] as JsonObject;
}

function notified(client: TestClient, method: string): JsonObject[] {
  return client
    .notifications()
    .filter((message) => message["method"] === method)
    .map((message) => message["params"] as JsonObject);
}

async function errorCode(client: TestClient, method: string, params: unknown): Promise<unknown> {
  const response = await client.request(method, params);
  if (!("error" in response)) return "no error";
  const error = response["error"] as JsonObject;
  return (error["data"] as JsonObject | undefined)?.["code"] ?? error["code"];
}

function eventCount(dbPath: string, sessionId: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT count(*) AS n FROM session_events WHERE session_id = ?").get(sessionId);
    return Number(row?.["n"]);
  } finally {
    db.close();
  }
}

describe("session.rename", () => {
  it("stores a trimmed title, announces it, and keeps the session's place", async () => {
    const { client } = await start();
    const sessionId = await idleSession(client);
    const before = sessionOf(await call(client, "session.get", { sessionId }));

    const renamed = sessionOf(await call(client, "session.rename", { sessionId, title: "  Fix the login bug  " }));
    expect(renamed["title"]).toBe("Fix the login bug");
    expect(renamed["updatedAt"]).toBe(before["updatedAt"]);
    await client.waitFor(() =>
      notified(client, "session.changed").some((params) => (params["session"] as JsonObject)["title"] === "Fix the login bug"),
    );
    const listed = (await call(client, "session.list", { workspaceId }))["sessions"] as JsonObject[];
    expect(listed.map((session) => session["title"])).toEqual(["Fix the login bug"]);
  });

  it("persists the title across an engine restart", async () => {
    const { client } = await start();
    const sessionId = await idleSession(client);
    await call(client, "session.rename", { sessionId, title: "Release notes" });
    if (engine === undefined) throw new Error("no engine");
    const reopened = openSeededStore(engine.dbPath);
    try {
      const stored = reopened.sessions.get(sessionId);
      expect(stored.ok && stored.value.title).toBe("Release notes");
    } finally {
      reopened.close();
    }
  });

  it("clears the title with an empty one, so the client's fallback shows", async () => {
    const { client } = await start();
    const sessionId = await idleSession(client);
    await call(client, "session.rename", { sessionId, title: "Something" });
    const cleared = sessionOf(await call(client, "session.rename", { sessionId, title: "   " }));
    expect(cleared["title"]).toBe("");
  });

  it("works on an ended session and refuses unknown ones and over-long titles", async () => {
    const { client } = await start();
    const sessionId = await idleSession(client);
    await call(client, "session.end", { sessionId });
    expect(sessionOf(await call(client, "session.rename", { sessionId, title: "Done" }))["title"]).toBe("Done");
    expect(await errorCode(client, "session.rename", { sessionId: "nope", title: "x" })).toBe("not_found");
    expect(await errorCode(client, "session.rename", { sessionId, title: "x".repeat(201) })).toBe("invalid_params");
  });
});

describe("session.delete", () => {
  it("removes an idle session, its events, runtime state and artifacts, and announces it", async () => {
    const { client, runtime, artifacts } = await start();
    const sessionId = await idleSession(client);
    const other = await idleSession(client);
    const written = await artifacts.write(sessionId, "tool-output.txt", "big output");
    expect(written.ok && existsSync(written.value.path)).toBe(true);
    if (engine === undefined) throw new Error("no engine");
    expect(eventCount(engine.dbPath, sessionId)).toBeGreaterThan(0);

    await call(client, "session.delete", { sessionId });

    await client.waitFor(() => notified(client, "session.deleted").some((params) => params["sessionId"] === sessionId));
    expect(await errorCode(client, "session.get", { sessionId })).toBe("not_found");
    const listed = (await call(client, "session.list", {}))["sessions"] as JsonObject[];
    expect(listed.map((session) => session["id"])).toEqual([other]);
    expect(eventCount(engine.dbPath, sessionId)).toBe(0);
    expect(eventCount(engine.dbPath, other)).toBeGreaterThan(0);
    expect(runtime.deletedSessionIds()).toEqual([sessionId]);
    expect(written.ok && existsSync(join(written.value.path, "..", ".."))).toBe(false);
    expect(await errorCode(client, "events.subscribe", { sessionId, afterSeq: 0 })).toBe("not_found");
  });

  it("keeps the session's usage, so spend totals do not drop", async () => {
    const { client } = await start();
    const sessionId = await idleSession(client);
    if (engine === undefined) throw new Error("no engine");
    const store = openSeededStore(engine.dbPath);
    try {
      store.usage.record({
        sessionId,
        agent: "main",
        model: "model-a",
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 10,
        credits: 1.25,
        tier: "reasoning",
        timestamp: "2026-11-13T09:00:30.000Z",
      });
    } finally {
      store.close();
    }
    const before = await call(client, "usage.rollup", { groupBy: "workspace" });

    await call(client, "session.delete", { sessionId });

    const after = await call(client, "usage.rollup", { groupBy: "workspace" });
    expect(after["rows"]).toEqual(before["rows"]);
    expect((after["rows"] as JsonObject[])[0]?.["credits"]).toBe(1.25);
  });

  it("stops a running turn first, then deletes", async () => {
    const { client } = await start([hangingTurn]);
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);
    await waitForEvent(client, subscriptionId, isState("idle"));
    await call(client, "session.send", { sessionId, text: "run the tests", mode: "send" });
    await waitForEvent(client, subscriptionId, (event) => event.type === "tool.started");
    expect((await call(client, "engine.health", {}))["sessionsRunning"]).toBe(1);

    await call(client, "session.delete", { sessionId });

    expect((await call(client, "engine.health", {}))["sessionsRunning"]).toBe(0);
    expect(await errorCode(client, "session.get", { sessionId })).toBe("not_found");
    expect(await errorCode(client, "session.send", { sessionId, text: "again", mode: "send" })).toBe("not_found");
  });

  it("deletes ended sessions, and refuses a second delete and a rename after it", async () => {
    const { client } = await start();
    const sessionId = await idleSession(client);
    await call(client, "session.end", { sessionId });
    await call(client, "session.delete", { sessionId });
    expect(await errorCode(client, "session.delete", { sessionId })).toBe("not_found");
    expect(await errorCode(client, "session.rename", { sessionId, title: "x" })).toBe("not_found");
  });
});
