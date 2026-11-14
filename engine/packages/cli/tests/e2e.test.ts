import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROCESS_TEST_TIMEOUT_MS, cliHarness, expectGolden } from "./helpers.ts";
import type { CliHarness } from "./helpers.ts";

let cli: CliHarness;

beforeEach(async () => {
  cli = await cliHarness();
});

afterEach(async () => {
  await cli.stop();
});

async function ok(args: readonly string[]): Promise<string> {
  const run = await cli.run(args);
  expect(run.stderr).toBe("");
  expect(run.code).toBe(0);
  return run.stdout;
}

const NEW = ["session", "new", "--workspace", "ws-1", "--repo", "repo-1", "summarize", "the", "README"];

describe("pica against a FakeRuntime engine", { timeout: PROCESS_TEST_TIMEOUT_MS }, () => {
  it("prints sessions, turns, replays and usage as text", async () => {
    await expectGolden("session-new.txt", await ok(NEW));

    await expectGolden("session-list.txt", await ok(["session", "list"]));

    const sent = await cli.run(["session", "send", "session-1", "now deploy it"]);
    expect(sent.code).toBe(4);
    await expectGolden("session-send.txt", sent.stdout);

    await expectGolden("session-attach.txt", await ok(["session", "attach", "session-1"]));
    await expectGolden("session-attach-after.txt", await ok(["session", "attach", "session-1", "--after", "12"]));
    await expectGolden("usage.txt", await ok(["usage"]));
    await expectGolden("usage-by-session.txt", await ok(["usage", "--by", "session"]));
    await expectGolden("usage-by-agent.txt", await ok(["usage", "--by", "agent", "--session", "session-1"]));
  });

  it("prints one JSON object per line with --json", async () => {
    await expectGolden("session-new.json", await ok(["--json", "session", "new", "--workspace", "ws-1", "--repo", "repo-1"]));
    await expectGolden("session-send.json", await ok(["--json", "session", "send", "session-1", "summarize the README"]));
    await expectGolden("session-attach.json", await ok(["--json", "session", "attach", "session-1", "--after", "5"]));
    await expectGolden("session-list.json", await ok(["session", "list", "--json"]));
    await expectGolden("usage.json", await ok(["usage", "--json", "--session", "session-1"]));
  });

  it("creates a session without running a turn when no prompt is given", async () => {
    const created = await cli.run(["session", "new", "--workspace", "ws-1", "--repo", "repo-1"]);
    expect(created).toEqual({ code: 0, stdout: "Session session-1\n", stderr: "" });
    await expectGolden("usage-empty.txt", await ok(["usage"]));
  });
});
