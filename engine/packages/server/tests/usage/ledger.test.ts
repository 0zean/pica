import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Store, TokenPrices } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { silentLogger, startEngine } from "../../src/index.ts";
import type { SocketListener } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import { call, createSession, isState, openSeededStore, received, subscribe, waitForEvent } from "../sessions/helpers.ts";

const reasoning: TokenPrices = { input: 300, cachedInput: 30, output: 1500 };
const worker: TokenPrices = { input: 25, cachedInput: 2.5, output: 125 };
const prices = new Map([
  ["model-r", reasoning],
  ["model-w", worker],
]);

// Two turns in which the main agent (model-r) delegates to two worker agents (model-w).
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
        { type: "usage", model: "model-r", inputTokens: 3000, cachedInputTokens: 2000, outputTokens: 400 },
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

// Hand-computed from the prices above (credits per million tokens).
// main:        1.08 + 1.56 + 0.87                         = 3.51
// bulk-reader: 50000 × 25e-6 + 800 × 125e-6               = 1.35
// code-writer: 20000 × 25e-6 + 5000 × 2.5e-6 + 1200 × 125e-6 = 0.6625
const expectedByAgent = [
  { key: "bulk-reader", calls: 1, inputTokens: 50000, cachedInputTokens: 0, outputTokens: 800, credits: 1.35 },
  { key: "code-writer", calls: 1, inputTokens: 20000, cachedInputTokens: 5000, outputTokens: 1200, credits: 0.6625 },
  { key: "main", calls: 3, inputTokens: 6500, cachedInputTokens: 7000, outputTokens: 900, credits: 3.51 },
];

interface Running {
  readonly engine: SocketListener;
  readonly store: Store;
  readonly client: TestClient;
  readonly dir: string;
}

let running: Running | undefined;

afterEach(async () => {
  if (running !== undefined) {
    running.client.close();
    await running.engine.close();
    running.store.close();
    await rm(running.dir, { recursive: true, force: true });
    running = undefined;
  }
});

async function start(): Promise<Running> {
  const dir = await mkdtemp(join(tmpdir(), "picad-usage-"));
  const store = openSeededStore(join(dir, "pica.db"));
  const ids = sequentialIds();
  const socketPath = join(dir, "run", "picad.sock");
  const engine = await startEngine({
    socketPath,
    log: silentLogger,
    sessions: {
      store,
      runtime: new FakeRuntime({ scenario: multiAgent }),
      clock: steppingClock("2026-11-13T09:00:00.000Z"),
      newSessionId: () => ids("session"),
      usage: {
        pricesFor: (model) => prices.get(model) ?? null,
        reasoningPrices: () => reasoning,
      },
    },
  });
  running = { engine, store, client: await TestClient.connectAndHello(socketPath), dir };
  return running;
}

async function runScenario(client: TestClient): Promise<string> {
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

describe("usage ledger", () => {
  it("records one priced UsageRecord per model call, totalling the fixture", async () => {
    const { client, store } = await start();
    const sessionId = await runScenario(client);

    const records = store.usage.listBySession(sessionId);
    expect(records.ok && records.value.map((record) => [record.agent, record.model, record.tier, record.credits])).toEqual([
      ["main", "model-r", "reasoning", 1.08],
      ["bulk-reader", "model-w", "worker", 1.35],
      ["main", "model-r", "reasoning", 1.56],
      ["code-writer", "model-w", "worker", 0.6625],
      ["main", "model-r", "reasoning", 0.87],
    ]);

    const byAgent = await call(client, "usage.rollup", { groupBy: "agent", sessionId });
    expect(byAgent["rows"]).toEqual(expectedByAgent);

    const bySession = await call(client, "usage.rollup", { groupBy: "session" });
    expect(bySession["rows"]).toEqual([
      { key: sessionId, calls: 5, inputTokens: 76500, cachedInputTokens: 12000, outputTokens: 2900, credits: 5.5225 },
    ]);
  });

  it("puts the same credits on the timeline as in the ledger", async () => {
    const { client } = await start();
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);
    await waitForEvent(client, subscriptionId, isState("idle"));
    await call(client, "session.send", { sessionId, text: "find the schema", mode: "send" });
    await client.waitFor(() => received(client, subscriptionId).filter((event) => event.type === "usage.recorded").length === 3);

    const credits = received(client, subscriptionId)
      .filter((event) => event.type === "usage.recorded")
      .map((event) => event.payload["credits"]);
    expect(credits).toEqual([1.08, 1.35, 1.56]);
  });

  it("reports the savings estimate for the worker-tier calls", async () => {
    const { client } = await start();
    await runScenario(client);

    // Worker tokens at reasoning rates: 70000 × 300e-6 + 5000 × 30e-6 + 2000 × 1500e-6 = 24.15,
    // minus the 2.0125 they cost.
    const result = await call(client, "usage.rollup", { groupBy: "model" });
    expect(result["savings"]).toEqual({ estimated: true, credits: 22.1375 });
  });
});
