import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedPolicyLoader } from "@pica/adapters";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";
import { fakePicadScenarios } from "../processes/fake-picad-scenarios.ts";

// A-16 over `picad`'s production composition, playing the `overview` scenario the app's UI tests play: what the
// Session Overview reads (`session.list`, `fanout.list`, `fanout.changed`) is there once sessions are idle, waiting
// for approval, or ran as a fan-out.

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function call(client: TestClient, method: string, params: unknown): Promise<JsonObject> {
  const response = await client.request(method, params);
  if (!("result" in response)) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response["result"] as JsonObject;
}

async function until<T>(find: () => Promise<T | undefined> | T | undefined, what: string): Promise<T> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const found = await find();
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function start(repoNames: readonly string[]): Promise<{ client: TestClient; workspaceId: string; repoIds: string[] }> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-a16-")));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const composed = composeEngine({
    homeDir: home,
    userName: "tester",
    env,
    log: silentLogger,
    runtime: new FakeRuntime({
      scenario: scenarioSchema.parse(fakePicadScenarios["overview"]),
      clock: steppingClock("2026-11-16T10:00:00.000Z"),
      ids: sequentialIds(),
    }),
    managedPolicy: new ManagedPolicyLoader([]),
  });
  const listener = await startEngine({ socketPath: join(home, "s"), log: silentLogger, ...composed.options });
  const client = await TestClient.connectAndHello(listener.socketPath);
  stop = async () => {
    client.close();
    await listener.close();
    await composed.close();
    rmSync(home, { recursive: true, force: true });
  };
  const { workspace } = (await call(client, "workspace.create", { name: "Atlas" })) as { workspace: { id: string } };
  const repoIds: string[] = [];
  for (const name of repoNames) {
    const path = join(home, "src", name);
    mkdirSync(path, { recursive: true });
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: path, env });
    execFileSync("git", ["remote", "add", "origin", `https://github.com/acme/${name}.git`], { cwd: path, env });
    const { repo } = (await call(client, "repo.addPath", { path })) as { repo: { id: string } };
    await call(client, "workspace.pinRepo", { workspaceId: workspace.id, repoId: repo.id });
    repoIds.push(repo.id);
  }
  return { client, workspaceId: workspace.id, repoIds };
}

async function state(client: TestClient, sessionId: string): Promise<string> {
  const { session } = (await call(client, "session.get", { sessionId })) as { session: { state: string } };
  return session.state;
}

describe("the overview scenario", () => {
  it("leaves a session idle after one message and waiting for approval after two", async () => {
    const { client, workspaceId, repoIds } = await start(["api"]);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const { session } = (await call(client, "session.create", { workspaceId, writeRepoIds: repoIds, referenceRepoIds: [] })) as {
        session: { id: string };
      };
      ids.push(session.id);
      await call(client, "session.send", { sessionId: session.id, text: "look", mode: "send" });
      await until(async () => ((await state(client, session.id)) === "idle" ? true : undefined), "idle");
    }
    const waiting = ids[1] ?? "";
    await call(client, "session.send", { sessionId: waiting, text: "test", mode: "send" });
    await until(async () => ((await state(client, waiting)) === "awaiting_approval" ? true : undefined), "awaiting_approval");

    const { sessions } = (await call(client, "session.list", {})) as { sessions: { id: string; state: string }[] };
    expect(Object.fromEntries(sessions.map((session) => [session.id, session.state]))).toEqual({
      [ids[0] ?? ""]: "idle",
      [waiting]: "awaiting_approval",
      [ids[2] ?? ""]: "idle",
    });
  });

  it("runs a fan-out to completion and announces each change of its aggregate", async () => {
    const { client, workspaceId, repoIds } = await start(["api", "web", "docs"]);
    const { fanOut } = (await call(client, "fanout.start", { workspaceId, repoIds, prompt: "Check the README", concurrency: 2 })) as {
      fanOut: { id: string };
    };
    const listed = await until(async () => {
      const { fanOuts } = (await call(client, "fanout.list", {})) as {
        fanOuts: { id: string; state: string; counts: Record<string, number>; runs: { sessionId: string | null }[] }[];
      };
      return fanOuts[0]?.state === "completed" ? fanOuts : undefined;
    }, "the fan-out to complete");
    expect(listed.map((entry) => entry.id)).toEqual([fanOut.id]);
    expect(listed[0]?.counts).toEqual({ queued: 0, active: 0, succeeded: 3, failed: 0, cancelled: 0 });
    expect(listed[0]?.runs.every((run) => run.sessionId !== null)).toBe(true);

    const changes = client
      .notifications()
      .filter((message) => message["method"] === "fanout.changed")
      .map((message) => (message["params"] as { fanOut: { id: string; state: string } }).fanOut);
    expect(changes.every((change) => change.id === fanOut.id)).toBe(true);
    expect(changes.at(-1)?.state).toBe("completed");
  });
});
