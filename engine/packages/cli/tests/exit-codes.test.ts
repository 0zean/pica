import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExitCode } from "../src/index.ts";
import { PROCESS_TEST_TIMEOUT_MS, cliHarness } from "./helpers.ts";
import type { CliHarness } from "./helpers.ts";

let cli: CliHarness;

beforeEach(async () => {
  cli = await cliHarness();
});

afterEach(async () => {
  await cli.stop();
});

describe("exit codes", { timeout: PROCESS_TEST_TIMEOUT_MS }, () => {
  it("are distinct for each kind of failure", () => {
    const codes = [ExitCode.ok, ExitCode.usage, ExitCode.engine, ExitCode.session];
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain(1);
  });

  it.each([
    [["frobnicate"]],
    [["session", "new", "--workspace", "ws-1"]],
    [["session", "send", "session-1"]],
    [["session", "attach", "session-1", "--after", "-3"]],
    [["usage", "--by", "colour"]],
    [["session", "list", "--bogus"]],
  ])("usage error for %j, without starting an engine", async (args) => {
    const run = await cli.run(args);
    expect(run.code).toBe(ExitCode.usage);
    expect(run.stderr).toMatch(/^pica: /);
    expect(await cli.engineStarts()).toEqual([]);
  });

  it("engine error when the engine cannot start", async () => {
    const run = await cli.run(["session", "list"], { PICA_ENGINE_ENTRY: join(cli.dir, "missing.ts") });
    expect(run.code).toBe(ExitCode.engine);
    expect(run.stderr).toContain("before it was ready");
  });

  it("engine error when the engine refuses the request", async () => {
    const run = await cli.run(["session", "attach", "no-such-session"]);
    expect(run.code).toBe(ExitCode.engine);
  });

  it("session failure when the turn reports an error", async () => {
    expect((await cli.run(["session", "new", "--workspace", "ws-1", "--repo", "repo-1", "summarize the README"])).code).toBe(0);
    const run = await cli.run(["--json", "session", "send", "session-1", "now deploy it"]);
    expect(run.code).toBe(ExitCode.session);
    expect(JSON.parse(run.stderr)).toEqual({
      error: { code: "runtime.quota_exhausted", message: "Session session-1: Monthly premium requests are used up." },
    });
  });
});
