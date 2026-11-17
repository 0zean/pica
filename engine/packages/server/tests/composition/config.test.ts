import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedPolicyLoader } from "@pica/adapters";
import type { ManagedPolicyFileSystem } from "@pica/adapters";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";

// A-14: the production composition serves `config.get` and `config.set` over the user layer, with
// managed-policy locks named.

let stop: (() => Promise<void>) | undefined;
let home: string;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

const policyPath = "/Library/Application Support/Pica/policy.jsonc";

function policyFiles(text: string): ManagedPolicyFileSystem {
  return {
    realpath: (path) => {
      if (path === policyPath) return path;
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    ownership: () => ({ uid: 0, mode: 0o644 }),
    readText: () => text,
    readPlist: () => ({}),
  };
}

async function start(policy?: string): Promise<TestClient> {
  home = realpathSync(mkdtempSync(join(tmpdir(), "picad-a14-")));
  const composed = composeEngine({
    homeDir: home,
    userName: "tester",
    env: {},
    log: silentLogger,
    runtime: new FakeRuntime({
      scenario: scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: [] }),
      clock: steppingClock("2026-11-17T10:00:00.000Z"),
      ids: sequentialIds(),
    }),
    managedPolicy:
      policy === undefined
        ? new ManagedPolicyLoader([])
        : new ManagedPolicyLoader([{ format: "jsonc", path: policyPath }], policyFiles(policy)),
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

function userFile(): string {
  return join(home, "Library", "Application Support", "Pica", "config.jsonc");
}

async function call(client: TestClient, method: string, params: unknown): Promise<Record<string, unknown>> {
  return await client.request(method, params);
}

async function get(client: TestClient, keyPath: string): Promise<Record<string, unknown>> {
  const response = await call(client, "config.get", { keyPath });
  if (!("result" in response)) throw new Error(JSON.stringify(response));
  return (response["result"] as { value: Record<string, unknown> }).value;
}

function errorCode(response: Record<string, unknown>): unknown {
  return (response["error"] as { data?: { code?: unknown } } | undefined)?.data?.code;
}

describe("A-14 config methods", () => {
  it("reads a default, then the user's value once it is set", async () => {
    const client = await start();
    expect(await get(client, "routing.tiers.reasoning")).toEqual({
      keyPath: "routing.tiers.reasoning",
      value: "auto",
      layer: "default",
      locked: false,
    });
    expect(await call(client, "config.set", { keyPath: "routing.tiers.reasoning", value: "model-a", layer: "user" })).toHaveProperty(
      "result",
      { ok: true },
    );
    expect(await get(client, "routing.tiers.reasoning")).toMatchObject({ value: "model-a", layer: "user" });
  });

  it("reads an object key from its leaves", async () => {
    const client = await start();
    expect(await get(client, "keybindings")).toEqual({ keyPath: "keybindings", value: {}, layer: "default", locked: false });
    await call(client, "config.set", { keyPath: "keybindings.toggleInspector", value: "cmd+ctrl+j", layer: "user" });
    expect(await get(client, "keybindings")).toMatchObject({ value: { toggleInspector: "cmd+ctrl+j" }, layer: "user" });
  });

  it("keeps the user's comments", async () => {
    const client = await start();
    mkdirSync(join(home, "Library", "Application Support", "Pica"), { recursive: true });
    writeFileSync(userFile(), '{\n  // mine\n  "budget": { "sessionCredits": 50 }\n}\n');
    await call(client, "config.set", { keyPath: "permissions.mode", value: "auto", layer: "user" });
    expect(readFileSync(userFile(), "utf8")).toContain("// mine");
    expect(await get(client, "budget.sessionCredits")).toMatchObject({ value: 50, layer: "user" });
  });

  it("names the policy that locks a key and refuses to set it", async () => {
    const client = await start('{ "id": "acme", "config": { "routing": { "tiers": { "reasoning": "model-b" } } } }');
    expect(await get(client, "routing.tiers.reasoning")).toEqual({
      keyPath: "routing.tiers.reasoning",
      value: "model-b",
      layer: "managed",
      locked: true,
      lockedBy: "acme",
    });
    expect(await get(client, "routing.tiers")).toMatchObject({ locked: true, lockedBy: "acme" });
    const refused = await call(client, "config.set", { keyPath: "routing.tiers.reasoning", value: "model-a", layer: "user" });
    expect(errorCode(refused)).toBe("policy_denied");
    expect(JSON.stringify(refused)).toContain("acme");
    const parent = await call(client, "config.set", { keyPath: "routing.tiers", value: { reasoning: "x" }, layer: "user" });
    expect(errorCode(parent)).toBe("policy_denied");
  });

  it("answers config_invalid for a value the schema refuses, and not_found for an unknown key", async () => {
    const client = await start();
    expect(errorCode(await call(client, "config.set", { keyPath: "budget.sessionCredits", value: -1, layer: "user" }))).toBe(
      "config_invalid",
    );
    expect(errorCode(await call(client, "config.get", { keyPath: "budget.nope" }))).toBe("not_found");
    expect(errorCode(await call(client, "config.set", { keyPath: "budget.sessionCredits", value: 1, layer: "workspace" }))).toBe(
      "invalid_params",
    );
  });
});
