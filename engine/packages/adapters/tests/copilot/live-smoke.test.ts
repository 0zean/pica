import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// S-01: with no Copilot CLI login stored, the runtime falls back to the `gh` CLI token. On Copilot
// Free that account lists no models, and Pica must say so with a sign-in hint instead of failing
// later. An empty COPILOT_HOME reproduces it without touching the user's real login. On a plan whose
// `gh` token lists models, the fallback simply works.
describe.skipIf(!live)("Copilot adapter live: gh CLI fallback (S-01)", () => {
  const home = mkdtempSync(join(tmpdir(), "pica-copilot-home-"));
  const runtime = new CopilotRuntime({ client: { baseDirectory: home } });
  afterAll(async () => {
    await runtime.stop();
    rmSync(home, { recursive: true, force: true });
  });

  it("reports runtime.no_models with a copilot login hint when the gh token lists no models", { timeout: 120_000 }, async () => {
    const models = await runtime.listModels();
    if (models.ok) {
      expect(models.value.length).toBeGreaterThan(0);
      return;
    }
    expect(models.error.code).toBe("runtime.no_models");
    expect(models.error.message).toContain("signed in via gh-cli");
    expect(models.error.message).toContain("copilot login");
    const created = await runtime.createSession({ workingDirectory: home });
    expect(created.ok ? "ok" : created.error.code).toBe("runtime.no_models");
  });
});
