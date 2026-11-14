import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store, TokenPrices } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { silentLogger, startEngine } from "../../src/index.ts";
import type { EngineSessionOptions, SocketListener } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import { call, createSession, isState, openSeededStore, received, subscribe, waitForEvent } from "../sessions/helpers.ts";

export const reasoning: TokenPrices = { input: 300, cachedInput: 30, output: 1500 };
const worker: TokenPrices = { input: 25, cachedInput: 2.5, output: 125 };
const prices = new Map([
  ["model-r", reasoning],
  ["model-w", worker],
]);

// The main agent (model-r) delegates to two worker agents (model-w) over two turns.
const multiAgent = scenarioSchema.parse({
  version: 1,
  models: [
    { id: "model-r", name: "Reasoning", tokenPrices: reasoning },
    { id: "model-w", name: "Worker", tokenPrices: worker },
  ],
  defaultModel: "model-r",
  turns: [
    {
      steps: [
        { type: "usage", model: "model-r", inputTokens: 2000, cachedInputTokens: 1000, outputTokens: 300 },
        {
          type: "subagent",
          agentName: "bulk-reader",
          model: "model-w",
          steps: [{ type: "usage", model: "model-w", inputTokens: 50000, outputTokens: 800 }],
        },
        { type: "text", content: "Found the schema." },
      ],
    },
    {
      steps: [
        {
          type: "subagent",
          agentName: "code-writer",
          model: "model-w",
          steps: [{ type: "usage", model: "model-w", inputTokens: 20000, cachedInputTokens: 5000, outputTokens: 1200 }],
        },
        { type: "usage", model: "model-r", inputTokens: 1500, cachedInputTokens: 4000, outputTokens: 200 },
      ],
    },
  ],
});

export interface FixtureEngine {
  readonly engine: SocketListener;
  readonly store: Store;
  readonly client: TestClient;
  readonly socketPath: string;
  stop(): Promise<void>;
}

export async function startFixtureEngine(extra: Partial<EngineSessionOptions> = {}): Promise<FixtureEngine> {
  const dir = await mkdtemp(join(tmpdir(), "picad-observability-"));
  const store = openSeededStore(join(dir, "pica.db"));
  const ids = sequentialIds();
  const socketPath = join(dir, "run", "picad.sock");
  const engine = await startEngine({
    socketPath,
    log: silentLogger,
    sessions: {
      store,
      runtime: new FakeRuntime({ scenario: multiAgent }),
      clock: steppingClock("2026-11-14T09:00:00.000Z"),
      newSessionId: () => ids("session"),
      usage: { pricesFor: (model) => prices.get(model) ?? null, reasoningPrices: () => reasoning },
      ...extra,
    },
  });
  const client = await TestClient.connectAndHello(socketPath);
  return {
    engine,
    store,
    client,
    socketPath,
    stop: async () => {
      client.close();
      await engine.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function runFixtureScenario(client: TestClient): Promise<string> {
  const sessionId = await createSession(client);
  const subscriptionId = await subscribe(client, sessionId);
  await waitForEvent(client, subscriptionId, isState("idle"));
  for (const text of ["find the schema", "write the tests"]) {
    const before = received(client, subscriptionId).length;
    await call(client, "session.send", { sessionId, text, mode: "send" });
    await client.waitFor(() =>
      received(client, subscriptionId)
        .slice(before)
        .some((event) => isState("idle")(event)),
    );
  }
  return sessionId;
}
