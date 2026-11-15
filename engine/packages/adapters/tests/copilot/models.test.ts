import { afterAll, describe, expect, it } from "vitest";
import { toQuotaInfo } from "../../src/copilot/models.ts";
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

  it("reports no credit quota when the account has only request-count snapshots (S-01)", async () => {
    const { runtime } = await replays.start("text-reply");
    const quota = await runtime.quota();
    expect(quota.ok ? quota.value : quota.error).toBeNull();
  });

  it("reads the credit quota from the ai_credits snapshot only", () => {
    const snapshot = (used: number, entitlement: number, unlimited = false) => ({
      isUnlimitedEntitlement: unlimited,
      entitlementRequests: entitlement,
      usedRequests: used,
      resetDate: "2026-12-01",
    });
    const free = { chat: snapshot(0, 200), completions: snapshot(0, 2000), premium_interactions: snapshot(0, 0) };
    expect(toQuotaInfo(free)).toBeNull();
    expect(toQuotaInfo({ ...free, ai_credits: snapshot(120, 1900) })).toEqual({ usedCredits: 120, entitlementCredits: 1900, resetDate: "2026-12-01" });
    expect(toQuotaInfo({ ai_credits: snapshot(5, 0, true) })).toMatchObject({ entitlementCredits: null });
  });
});
