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

  it("converts nano-AIU prices to credits, using the unit models.listTokenPriceUnits reports (S-01)", async () => {
    const { runtime } = await replays.start("nano-aiu-prices");
    const models = await runtime.listModels();
    if (!models.ok) throw new Error(models.error.code);
    const byId = new Map(models.value.map((model) => [model.id, model.tokenPrices]));
    // S-01 run 2: 2e10 nano-AIU per million input tokens is 20 credits.
    expect(byId.get("nano-1")).toEqual({ input: 20, cachedInput: 2, output: 120 });
    expect(byId.get("credits-1")?.input).toBeCloseTo(15);
  });

  it("drops prices whose unit the runtime does not report, instead of guessing (D-16)", async () => {
    const { runtime } = await replays.start("nano-aiu-prices");
    const models = await runtime.listModels();
    if (!models.ok) throw new Error(models.error.code);
    const unknown = models.value.find((model) => model.id === "unknown-unit-1");
    expect(unknown).toBeDefined();
    expect(unknown).not.toHaveProperty("tokenPrices");
  });

  it("drops every price when the price-unit call fails", async () => {
    const { runtime } = await replays.start("price-units-unavailable");
    const models = await runtime.listModels();
    expect(models.ok ? models.value : models.error).toEqual([{ id: "worker-1", name: "Worker 1", contextWindow: 128000 }]);
  });

  it("lists Free's virtual auto model with no prices and no context window (S-01)", async () => {
    const { runtime } = await replays.start("default-model-only");
    const models = await runtime.listModels();
    expect(models.ok ? models.value : models.error).toEqual([{ id: "auto", name: "Auto" }]);
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
