import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedPolicyLoader } from "@pica/adapters";
import { FakeRuntime, scenarioSchema, writeCorruptDatabase } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, picaDataDir, silentLogger, startEngine } from "../../src/index.ts";
import type { Logger } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";

// H-05: picad's production composition, started over a damaged pica.db.

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: [] });

interface Started {
  readonly client: TestClient;
  readonly stop: () => Promise<void>;
}

async function startOver(home: string, log: Logger): Promise<Started> {
  const composed = composeEngine({
    homeDir: home,
    userName: "tester",
    env: { PATH: process.env["PATH"] },
    log,
    runtime: new FakeRuntime({ scenario }),
    managedPolicy: new ManagedPolicyLoader([]),
  });
  const listener = await startEngine({ socketPath: join(home, "s"), log: silentLogger, ...composed.options });
  const client = await TestClient.connectAndHello(listener.socketPath);
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    client.close();
    await listener.close();
    await composed.close();
  };
  cleanups.push(stop);
  return { client, stop };
}

async function health(client: TestClient): Promise<Record<string, unknown>> {
  const response = await client.request("engine.health", {});
  expect(response["error"]).toBeUndefined();
  return response["result"] as Record<string, unknown>;
}

function tempHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-h05-")));
  cleanups.push(() => {
    rmSync(home, { recursive: true, force: true });
    return Promise.resolve();
  });
  return home;
}

describe("corrupt database (H-05)", () => {
  it("moves the database aside, starts clean, and reports the backup path in engine.health", async () => {
    const home = tempHome();
    const dataDir = picaDataDir(home);
    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, "pica.db");
    writeCorruptDatabase(dbPath, "damaged-pages");
    const warnings: string[] = [];
    const log: Logger = { ...silentLogger, warn: (message) => warnings.push(message) };

    const { client } = await startOver(home, log);

    const result = await health(client);
    const recovery = result["storeRecovery"] as Record<string, string>;
    expect(recovery["backupPath"]).toMatch(new RegExp(`^${dbPath}\\.corrupt-\\d{8}T\\d{6}Z$`));
    expect(recovery["reason"]).toMatch(/malformed|integrity/);
    expect(existsSync(recovery["backupPath"] ?? "")).toBe(true);
    expect(warnings.join("\n")).toContain(recovery["backupPath"]);

    const sessions = await client.request("session.list", {});
    expect(sessions["result"]).toEqual({ sessions: [] });
    const created = await client.request("workspace.create", { name: "After recovery" });
    expect(created["error"]).toBeUndefined();
  });

  it("reports no recovery once the engine runs on the database a recovery made", async () => {
    const home = tempHome();
    const dataDir = picaDataDir(home);
    mkdirSync(dataDir, { recursive: true });
    writeCorruptDatabase(join(dataDir, "pica.db"), "not-a-database");
    const first = await startOver(home, silentLogger);
    expect(await health(first.client)).toHaveProperty("storeRecovery");
    await first.stop();

    const second = await startOver(home, silentLogger);
    expect(await health(second.client)).not.toHaveProperty("storeRecovery");
  });
});
