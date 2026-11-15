import { describe, expect, it } from "vitest";
import { resolveTier, resolveTiers } from "../../src/index.ts";
import type { CatalogModel, ManagedModelPolicy, ModelTier, TierResolutionReason } from "../../src/index.ts";

function model(id: string, input: number | null, output = 0): CatalogModel {
  return {
    id,
    name: id,
    prices: input === null ? null : { input, cachedInput: input / 10, output },
    priceSource: input === null ? null : "runtime",
    contextWindow: null,
  };
}

const catalog: readonly CatalogModel[] = [
  model("frontier-1", 125, 1000),
  model("frontier-2", 300, 1500),
  model("worker-1", 15, 60),
  model("worker-2", 25, 200),
  model("unpriced-1", null),
];

interface Case {
  readonly name: string;
  readonly tier: ModelTier;
  readonly setting: string;
  readonly models?: readonly CatalogModel[];
  readonly policy?: ManagedModelPolicy;
  readonly expected: string | null;
  readonly reason: TierResolutionReason;
}

const cases: readonly Case[] = [
  { name: "auto reasoning takes the highest rate", tier: "reasoning", setting: "auto", expected: "frontier-2", reason: "auto" },
  { name: "auto worker takes the lowest rate", tier: "worker", setting: "auto", expected: "worker-1", reason: "auto" },
  { name: "a listed, allowed model is used as configured", tier: "reasoning", setting: "frontier-1", expected: "frontier-1", reason: "configured" },
  { name: "a worker may be configured to any listed model", tier: "worker", setting: "worker-2", expected: "worker-2", reason: "configured" },
  { name: "an unpriced model can still be configured", tier: "worker", setting: "unpriced-1", expected: "unpriced-1", reason: "configured" },
  { name: "a missing preferred model falls back to auto", tier: "reasoning", setting: "gone-9", expected: "frontier-2", reason: "fallback_missing" },
  { name: "a missing preferred worker falls back to auto", tier: "worker", setting: "gone-9", expected: "worker-1", reason: "fallback_missing" },
  {
    name: "a preferred model on the managed deny list falls back to auto",
    tier: "reasoning",
    setting: "frontier-1",
    policy: { deny: ["frontier-1"] },
    expected: "frontier-2",
    reason: "fallback_blocked",
  },
  {
    name: "a preferred model outside the managed allow list falls back to auto",
    tier: "worker",
    setting: "worker-2",
    policy: { allow: ["worker-1", "frontier-1"] },
    expected: "worker-1",
    reason: "fallback_blocked",
  },
  {
    name: "deny wins over allow for the same model",
    tier: "reasoning",
    setting: "frontier-2",
    policy: { allow: ["frontier-1", "frontier-2"], deny: ["frontier-2"] },
    expected: "frontier-1",
    reason: "fallback_blocked",
  },
  {
    name: "auto skips a blocked model",
    tier: "reasoning",
    setting: "auto",
    policy: { deny: ["frontier-2"] },
    expected: "frontier-1",
    reason: "auto",
  },
  {
    name: "auto keeps to the allow list",
    tier: "worker",
    setting: "auto",
    policy: { allow: ["frontier-1", "frontier-2"] },
    expected: "frontier-1",
    reason: "auto",
  },
  {
    name: "auto ignores unpriced models",
    tier: "worker",
    setting: "auto",
    models: [model("unpriced-1", null), model("frontier-1", 125, 1000)],
    expected: "frontier-1",
    reason: "auto",
  },
  {
    name: "auto breaks a rate tie by the smaller id",
    tier: "worker",
    setting: "auto",
    models: [model("b-model", 10, 10), model("a-model", 10, 10)],
    expected: "a-model",
    reason: "auto",
  },
  {
    name: "a missing preferred model with nothing allowed is unresolved",
    tier: "reasoning",
    setting: "gone-9",
    policy: { allow: [] },
    expected: null,
    reason: "unresolved",
  },
  {
    name: "a blocked preferred model with nothing else priced is unresolved",
    tier: "worker",
    setting: "worker-1",
    models: [model("worker-1", 15, 60), model("unpriced-1", null)],
    policy: { deny: ["worker-1"] },
    expected: null,
    reason: "unresolved",
  },
  { name: "an empty catalog is unresolved", tier: "worker", setting: "auto", models: [], expected: null, reason: "unresolved" },
];

describe("resolveTier", () => {
  it.each(cases)("$name", (testCase) => {
    const resolution = resolveTier(testCase.tier, testCase.setting, testCase.models ?? catalog, testCase.policy ?? {});
    expect(resolution).toEqual({
      tier: testCase.tier,
      setting: testCase.setting,
      resolvedModelId: testCase.expected,
      reason: testCase.reason,
    });
  });
});

// Copilot Free lists only the virtual, unpriced `auto` model (S-01). Every tier must leave the
// model unset, so the runtime's own routing applies, and no setting may pick `auto` as a model id.
describe("default-model-only plans (S-01)", () => {
  const freeCatalog = [model("auto", null)];
  it.each([
    { reasoning: "auto", worker: "auto" },
    { reasoning: "frontier-1", worker: "worker-1" },
  ])("resolves every tier to the runtime's default for %o", (settings) => {
    const resolutions = resolveTiers(settings, freeCatalog, {});
    expect(resolutions.map((resolution) => [resolution.resolvedModelId, resolution.reason])).toEqual([
      [null, "unresolved"],
      [null, "unresolved"],
    ]);
  });
});

describe("resolveTiers", () => {
  it("resolves both tiers in a fixed order", () => {
    expect(resolveTiers({ reasoning: "frontier-1", worker: "auto" }, catalog, { deny: ["worker-1"] })).toEqual([
      { tier: "reasoning", setting: "frontier-1", resolvedModelId: "frontier-1", reason: "configured" },
      { tier: "worker", setting: "auto", resolvedModelId: "worker-2", reason: "auto" },
    ]);
  });
});
