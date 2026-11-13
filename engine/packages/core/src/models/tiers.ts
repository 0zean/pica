import type { TokenPrices } from "../runtime/port.ts";
import type { CatalogModel, ManagedModelPolicy, ModelTier } from "./types.ts";

export const autoTierSetting = "auto";

// How a tier got its model:
// - `configured`: the setting named a model that is listed and allowed.
// - `auto`: the setting is `auto` and the rule below picked a model.
// - `fallback_missing` / `fallback_blocked`: the named model is not listed, or managed policy
//   blocks it, so the `auto` rule picked instead.
// - `unresolved`: no allowed model qualifies; the runtime's default model applies.
export type TierResolutionReason = "configured" | "auto" | "fallback_missing" | "fallback_blocked" | "unresolved";

export interface TierResolution {
  readonly tier: ModelTier;
  readonly setting: string;
  readonly resolvedModelId: string | null;
  readonly reason: TierResolutionReason;
}

export type TierSettingsInput = Readonly<Record<ModelTier, string>>;

export const modelTiers: readonly ModelTier[] = ["reasoning", "worker"];

export function isModelAllowed(modelId: string, policy: ManagedModelPolicy): boolean {
  if (policy.deny?.includes(modelId) === true) return false;
  return policy.allow === undefined || policy.allow.includes(modelId);
}

export function resolveTier(
  tier: ModelTier,
  setting: string,
  models: readonly CatalogModel[],
  policy: ManagedModelPolicy,
): TierResolution {
  if (setting !== autoTierSetting) {
    const named = models.find((model) => model.id === setting);
    if (named !== undefined && isModelAllowed(named.id, policy)) {
      return { tier, setting, resolvedModelId: named.id, reason: "configured" };
    }
    const fallback = named === undefined ? "fallback_missing" : "fallback_blocked";
    return withAuto(tier, setting, models, policy, fallback);
  }
  return withAuto(tier, setting, models, policy, "auto");
}

export function resolveTiers(
  settings: TierSettingsInput,
  models: readonly CatalogModel[],
  policy: ManagedModelPolicy,
): readonly TierResolution[] {
  return modelTiers.map((tier) => resolveTier(tier, settings[tier], models, policy));
}

function withAuto(
  tier: ModelTier,
  setting: string,
  models: readonly CatalogModel[],
  policy: ManagedModelPolicy,
  reason: TierResolutionReason,
): TierResolution {
  const picked = pickAuto(tier, models, policy);
  return picked === undefined
    ? { tier, setting, resolvedModelId: null, reason: "unresolved" }
    : { tier, setting, resolvedModelId: picked, reason };
}

interface PricedModel {
  readonly id: string;
  readonly prices: TokenPrices;
}

// The `auto` rule (D-09: no model ids in code): among allowed models with known prices,
// `reasoning` takes the highest blended rate and `worker` the lowest. Ties go to the smaller id.
function pickAuto(tier: ModelTier, models: readonly CatalogModel[], policy: ManagedModelPolicy): string | undefined {
  const candidates: PricedModel[] = [];
  for (const model of models) {
    if (model.prices !== null && isModelAllowed(model.id, policy)) {
      candidates.push({ id: model.id, prices: model.prices });
    }
  }
  const direction = tier === "reasoning" ? -1 : 1;
  candidates.sort((a, b) => direction * (blendedRate(a.prices) - blendedRate(b.prices)) || compareIds(a.id, b.id));
  return candidates[0]?.id;
}

function blendedRate(prices: TokenPrices): number {
  return prices.input + prices.output;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
