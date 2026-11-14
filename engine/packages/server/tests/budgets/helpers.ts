import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BudgetSettings, Store, TokenPrices } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import type { Scenario } from "@pica/testkit";
import { silentLogger, startEngine } from "../../src/index.ts";
import type { SocketListener } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";
import { call, openSeededStore, repoId, workspaceId } from "../sessions/helpers.ts";

// 100 credits per million input tokens: every 10,000-token call costs exactly 1 credit.
export const prices: TokenPrices = { input: 100, cachedInput: 0, output: 0 };
export const oneCreditCall = { type: "usage", model: "model-a", inputTokens: 10_000, outputTokens: 0 };
export const engineStart = "2026-11-13T09:00:00.000Z";

export function pricedScenario(turns: unknown[]): Scenario {
  return scenarioSchema.parse({
    version: 1,
    models: [{ id: "model-a", name: "Model A", tokenPrices: prices }],
    defaultModel: "model-a",
    turns,
  });
}

export interface BudgetEngine {
  readonly store: Store;
  readonly runtime: FakeRuntime;
  readonly client: TestClient;
  stop(): Promise<void>;
}

export async function startBudgetEngine(scenario: Scenario, budget: BudgetSettings): Promise<BudgetEngine> {
  const dir = await mkdtemp(join(tmpdir(), "picad-budgets-"));
  const socketPath = join(dir, "run", "picad.sock");
  const store = openSeededStore(join(dir, "pica.db"));
  const runtime = new FakeRuntime({ scenario, clock: steppingClock(engineStart) });
  const ids = sequentialIds();
  const engine: SocketListener = await startEngine({
    socketPath,
    log: silentLogger,
    sessions: {
      store,
      runtime,
      clock: steppingClock(engineStart),
      newSessionId: () => ids("session"),
      usage: { pricesFor: (model) => (model === "model-a" ? prices : null) },
      budget,
    },
  });
  const client = await TestClient.connectAndHello(socketPath);
  return {
    store,
    runtime,
    client,
    stop: async () => {
      client.close();
      await engine.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function createRequest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { workspaceId, writeRepoIds: [repoId], referenceRepoIds: [], ...extra };
}

export async function createSessionWith(client: TestClient, extra: Record<string, unknown> = {}): Promise<JsonObject> {
  const result = await call(client, "session.create", createRequest(extra));
  return result["session"] as JsonObject;
}

export async function sessionState(client: TestClient, sessionId: string): Promise<JsonObject> {
  return (await call(client, "session.get", { sessionId }))["session"] as JsonObject;
}
