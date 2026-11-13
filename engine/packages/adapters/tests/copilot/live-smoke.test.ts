import { recordTurn } from "@pica/testkit";
import { afterAll, describe, expect, it } from "vitest";
import { CopilotRuntime } from "../../src/index.ts";

// Live check (PLAN.md §8): runs only with PICA_LIVE=1 and a signed-in Copilot user.
const live = process.env.PICA_LIVE === "1";

describe.skipIf(!live)("Copilot adapter live smoke", () => {
  const runtime = new CopilotRuntime();
  afterAll(() => runtime.stop());

  it("completes one prompt end to end", { timeout: 180_000 }, async () => {
    const models = await runtime.listModels();
    if (!models.ok) throw new Error(`${models.error.code}: ${models.error.message}`);
    expect(models.value.length).toBeGreaterThan(0);
    const created = await runtime.createSession({ workingDirectory: process.cwd() });
    if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message}`);
    const turn = await recordTurn(created.value, "Reply with the single word: pong");
    if (!turn.ok) throw new Error(`${turn.error.code}: ${turn.error.message}`);
    const types = turn.value.events.map((event) => event.type);
    expect(types.at(-1)).toBe("session.idle");
    expect(types).toContain("assistant.message");
    expect(types).toContain("assistant.usage");
    expect(types).not.toContain("session.error");
    await created.value.close();
  });
});
