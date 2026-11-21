import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedPolicyLoader } from "@pica/adapters";
import type { GitInstallation } from "@pica/core";
import { FakeRuntime, scenarioSchema } from "@pica/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { composeEngine, silentLogger, startEngine } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";

// A-15: the production composition answers `engine.git` for onboarding's precondition check.

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function gitInstall(probe?: () => Promise<GitInstallation>): Promise<unknown> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "picad-a15-")));
  const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: [] });
  const composed = composeEngine({
    homeDir: home,
    userName: "tester",
    env: { PATH: process.env["PATH"] },
    log: silentLogger,
    runtime: new FakeRuntime({ scenario }),
    managedPolicy: new ManagedPolicyLoader([]),
    ...(probe === undefined ? {} : { gitInstall: probe }),
  });
  const listener = await startEngine({ socketPath: join(home, "s"), log: silentLogger, ...composed.options });
  const client = await TestClient.connectAndHello(listener.socketPath);
  stop = async () => {
    client.close();
    await listener.close();
    await composed.close();
    rmSync(home, { recursive: true, force: true });
  };
  const response = await client.request("engine.git", {});
  expect(response["error"]).toBeUndefined();
  return (response["result"] as Record<string, unknown>)["git"];
}

describe("engine.git (A-15)", () => {
  it("reports the git the engine runs", async () => {
    const git = (await gitInstall()) as GitInstallation;
    expect(git).toMatchObject({ status: "installed", message: null });
    expect(git.version).toMatch(/^\d+\.\d+/);
  });

  it("reports what the probe found missing", async () => {
    const missing: GitInstallation = { status: "missing", version: null, message: "xcode-select: note: No developer tools were found" };
    expect(await gitInstall(() => Promise.resolve(missing))).toEqual(missing);
  });
});
