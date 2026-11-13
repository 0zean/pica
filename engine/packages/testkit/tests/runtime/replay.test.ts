import type { RuntimeHooks, RuntimeSession } from "@pica/core";
import {
  FakeRuntime,
  formatScenarioError,
  loadScenarioFile,
  recordTurn,
  sequentialIds,
  steppingClock,
  type Scenario,
} from "../../src/index.ts";
import { describe, expect, it } from "vitest";

const scenarioFile = new URL("../../fixtures/runtime/full-tour.jsonc", import.meta.url).pathname;

function loadTour(): Scenario {
  const loaded = loadScenarioFile(scenarioFile);
  if (!loaded.ok) {
    throw new Error(formatScenarioError(loaded.error));
  }
  return loaded.value;
}

// Deny destructive shell commands, ask before writes, and trim what `view` returns.
const hooks: RuntimeHooks = {
  onPreToolUse: (input) => {
    const command = JSON.stringify(input.arguments);
    if (input.toolName === "bash" && command.includes("rm -rf")) {
      return Promise.resolve({ decision: "deny", reason: "destructive command" });
    }
    if (input.toolName === "write") {
      return Promise.resolve({ decision: "ask", reason: "writes need approval" });
    }
    return Promise.resolve({ decision: "allow" });
  },
  onPostToolUse: (input) =>
    Promise.resolve(
      input.toolName === "view" ? { kind: "modify", result: { content: input.result.content.slice(0, 6) } } : { kind: "keep" },
    ),
};

async function drive(session: RuntimeSession): Promise<void> {
  await recordTurn(session, "summarize the repo");
  let asks = 0;
  await recordTurn(session, "write notes", (event) => {
    if (event.type === "permission.requested") {
      asks += 1;
      void session.resolvePermission(event.data.requestId, asks === 1);
    }
  });
  await recordTurn(session, "run the tests", (event) => {
    if (event.type === "tool.execution_start") {
      void session.abort();
    }
  });
  await recordTurn(session, "try again");
  await session.close();
}

async function replay(clockStart?: string): Promise<string> {
  const runtime = new FakeRuntime({ scenario: loadTour(), clock: steppingClock(clockStart), ids: sequentialIds() });
  for (const workingDirectory of ["/repo/a", "/repo/b"]) {
    const created = await runtime.createSession({ workingDirectory, hooks });
    if (!created.ok) {
      throw new Error(created.error.message);
    }
    await drive(created.value);
  }
  return runtime.eventLog().map((event) => JSON.stringify(event)).join("\n") + "\n";
}

describe("FakeRuntime replay", () => {
  it("produces byte-identical event logs when a scenario is replayed", async () => {
    const first = await replay();
    const second = await replay();
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });

  // Regenerate with `pnpm exec vitest run -u` after an intended change to the event shape.
  it("matches the committed golden log", async () => {
    await expect(await replay()).toMatchFileSnapshot("./golden/full-tour.ndjson");
  });

  it("covers every runtime event type", async () => {
    const types = new Set((await replay()).trim().split("\n").map((line) => (JSON.parse(line) as { type: string }).type));
    expect([...types].sort()).toEqual(
      [
        "abort",
        "assistant.message",
        "assistant.message_delta",
        "assistant.turn_end",
        "assistant.turn_start",
        "assistant.usage",
        "permission.completed",
        "permission.requested",
        "session.error",
        "session.idle",
        "session.start",
        "session.usage_info",
        "subagent.completed",
        "subagent.failed",
        "subagent.started",
        "tool.execution_complete",
        "tool.execution_start",
        "user.message",
      ].sort(),
    );
  });

  it("takes timestamps only from the injected clock", async () => {
    const shifted = await replay("2030-06-01T00:00:00.000Z");
    const original = await replay();
    expect(shifted).not.toBe(original);
    expect(shifted.replaceAll("2030-06-01", "2026-01-01")).toBe(original);
  });
});
