import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENGINE_ENTRY } from "@pica/server";
import { PROCESS_TEST_TIMEOUT_MS, cliHarness } from "./helpers.ts";
import type { CliHarness } from "./helpers.ts";

let cli: CliHarness;

beforeEach(async () => {
  cli = await cliHarness();
});

afterEach(async () => {
  await cli.stop();
});

describe("engine lifecycle", { timeout: PROCESS_TEST_TIMEOUT_MS }, () => {
  it("starts an engine when none is running and reuses it afterwards", async () => {
    expect(await cli.engineStarts()).toEqual([]);

    expect((await cli.run(["session", "list"])).code).toBe(0);
    const [first] = await cli.engineStarts();
    expect(first).toBeDefined();

    expect((await cli.run(["session", "new", "--workspace", "ws-1", "--repo", "repo-1"])).code).toBe(0);
    expect((await cli.run(["session", "list"])).stdout).toContain("session-1");
    expect(await cli.engineStarts()).toEqual([first]);
  });

  it("starts one engine when two commands race to start it", async () => {
    const runs = await Promise.all([cli.run(["session", "list"]), cli.run(["session", "list"])]);
    expect(runs.map((run) => run.code)).toEqual([0, 0]);
    expect(await cli.engineStarts()).toHaveLength(1);
  });

  it("starts the real picad by default", async () => {
    // HOME keeps the engine's store and config inside the test directory.
    const run = await cli.run(["session", "list"], { PICA_ENGINE_ENTRY: ENGINE_ENTRY, HOME: cli.dir });
    expect((await lstat(cli.socketPath)).isSocket()).toBe(true);
    // E-11: the composed engine answers session methods from its own store.
    expect(run).toEqual({ code: 0, stdout: "No sessions.\n", stderr: "" });
    expect((await lstat(join(cli.dir, "Library", "Application Support", "Pica", "pica.db"))).isFile()).toBe(true);
  });
});
