import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedPolicyLoader } from "@pica/adapters";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";

// A-06: the production composition answers what the composer completes and picks from.

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function start(): Promise<TestClient> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-a06-")));
  const scenario = scenarioSchema.parse({
    version: 1,
    models: [
      { id: "model-a", name: "Model A", tokenPrices: { input: 1, cachedInput: 0.1, output: 4 }, supportsReasoningEffort: true },
      { id: "model-b", name: "Model B", tokenPrices: { input: 0.1, cachedInput: 0.01, output: 0.4 } },
    ],
    defaultModel: "model-a",
    turns: [],
  });
  const composed = composeEngine({
    homeDir: home,
    userName: "tester",
    env: {},
    log: silentLogger,
    runtime: new FakeRuntime({ scenario, clock: steppingClock("2026-11-16T10:00:00.000Z"), ids: sequentialIds() }),
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
  return client;
}

async function result(client: TestClient, method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  const response = await client.request(method, params);
  if (!("result" in response)) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response["result"] as Record<string, unknown>;
}

describe("A-06 catalog methods", () => {
  it("lists the built-in agents", async () => {
    const client = await start();
    const { agents } = (await result(client, "agents.list", { workspaceId: "w1" })) as { agents: { name: string; sourceLayer: string }[] };
    expect(agents.map((agent) => agent.name)).toEqual(expect.arrayContaining(["bulk-reader", "code-writer", "repo-scout"]));
    expect(agents.every((agent) => agent.sourceLayer === "builtin")).toBe(true);
  });

  it("lists the runtime's models with their prices", async () => {
    const client = await start();
    const { models } = (await result(client, "models.list")) as { models: unknown[] };
    expect(models).toEqual([
      { id: "model-a", name: "Model A", prices: { input: 1, cachedInput: 0.1, output: 4 }, allowedByPolicy: true },
      { id: "model-b", name: "Model B", prices: { input: 0.1, cachedInput: 0.01, output: 0.4 }, allowedByPolicy: true },
    ]);
  });

  it("resolves both tiers from the config's settings", async () => {
    const client = await start();
    const { tiers } = (await result(client, "models.tiers")) as { tiers: { tier: string; setting: string; resolvedModelId: string | null }[] };
    expect(tiers.map((tier) => [tier.tier, tier.setting])).toEqual([
      ["reasoning", "auto"],
      ["worker", "auto"],
    ]);
    // `auto` puts a model with reasoning effort on the reasoning tier and the cheapest on the worker tier (C-01).
    expect(tiers.map((tier) => tier.resolvedModelId)).toEqual(["model-a", "model-b"]);
  });
});
