import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionArtifacts } from "@pica/adapters";
import { defaultCommandDenyList } from "@pica/core";
import type { PolicyContext } from "@pica/core";
import { PicaConfig } from "@pica/protocol";
import { FakeRuntime, sequentialIds, steppingClock } from "@pica/testkit";
import { silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import { call, createSession, openSeededStore, received, scenario, subscribe, waitForEvent } from "./helpers.ts";

const maxBytes = 1024;
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function policyContext(): PolicyContext {
  return {
    cwd: "/src/acme/api",
    writeRoots: ["/src/acme/api"],
    referenceRoots: [],
    config: PicaConfig.parse({ routing: { profile: "balanced", delegation: { output: { maxBytes } } } }),
    managed: [],
    commandDenyList: defaultCommandDenyList,
  };
}

async function startGuardedEngine(runtime: FakeRuntime): Promise<{ client: TestClient; artifactsDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "picad-output-guard-"));
  const artifactsDir = join(dir, "sessions");
  const store = openSeededStore(join(dir, "pica.db"));
  const ids = sequentialIds();
  const engine = await startEngine({
    socketPath: join(dir, "run", "picad.sock"),
    log: silentLogger,
    sessions: {
      store,
      runtime,
      clock: steppingClock("2026-11-14T09:00:00.000Z"),
      newSessionId: () => ids("session"),
      outputGuard: { artifacts: createSessionArtifacts(artifactsDir), policyContext },
    },
  });
  const client = await TestClient.connectAndHello(join(dir, "run", "picad.sock"));
  cleanups.push(async () => {
    client.close();
    await engine.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { client, artifactsDir };
}

describe("output guard wired into the session service", () => {
  it("returns a capped result to the agent and spills a byte-equal artifact", async () => {
    const original = `${"héllo wörld 🌍 ".repeat(400)}\u0000\u0001 end`;
    const runtime = new FakeRuntime({
      scenario: scenario([
        { steps: [{ type: "toolCall", name: "bash", arguments: { command: "cat big.log" }, result: original }] },
      ]),
    });
    const { client, artifactsDir } = await startGuardedEngine(runtime);
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);

    await call(client, "session.send", { sessionId, text: "show the log", mode: "send" });
    const completed = await waitForEvent(client, subscriptionId, (event) => event.type === "tool.completed");

    expect(completed.payload["resultBytes"]).toBeLessThanOrEqual(maxBytes);
    const toolCallId = completed.payload["toolCallId"] as string;
    const artifact = join(artifactsDir, sessionId, "artifacts", "tool-output", `${toolCallId}.txt`);
    expect(await readFile(artifact)).toEqual(Buffer.from(original, "utf8"));
    expect(received(client, subscriptionId).some((event) => event.type === "tool.failed")).toBe(false);
  });

  it("leaves a result within the cap untouched", async () => {
    const runtime = new FakeRuntime({
      scenario: scenario([{ steps: [{ type: "toolCall", name: "bash", arguments: { command: "pwd" }, result: "/src/acme/api" }] }]),
    });
    const { client } = await startGuardedEngine(runtime);
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);

    await call(client, "session.send", { sessionId, text: "where am I", mode: "send" });
    const completed = await waitForEvent(client, subscriptionId, (event) => event.type === "tool.completed");
    expect(completed.payload["resultBytes"]).toBe("/src/acme/api".length);
  });
});
