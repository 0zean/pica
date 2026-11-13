import { afterAll, describe, expect, it } from "vitest";
import { ReplayRuntimes } from "./replay-harness.ts";

const replays = new ReplayRuntimes();
afterAll(() => replays.stopAll());

describe("Copilot models and quota", () => {
  it("converts per-batch token prices to credits per million tokens", async () => {
    const { runtime } = await replays.start("text-reply");
    const models = await runtime.listModels();
    if (!models.ok) throw new Error(models.error.code);
    const worker = models.value.find((model) => model.id === "worker-1");
    expect(worker?.tokenPrices?.input).toBeCloseTo(15);
    expect(worker?.tokenPrices?.cachedInput).toBeCloseTo(1.5);
    expect(worker?.tokenPrices?.output).toBeCloseTo(60);
    expect(worker?.contextWindow).toBe(128000);
  });

  it("reads quota from the account snapshot", async () => {
    const { runtime } = await replays.start("text-reply");
    const quota = await runtime.quota();
    expect(quota.ok ? quota.value : quota.error).toEqual({ usedCredits: 120, entitlementCredits: 1900, resetDate: "2026-12-01" });
  });
});
