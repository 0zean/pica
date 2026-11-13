import type { QuotaInfo, RuntimeModel } from "@pica/core";
import type { ModelInfo } from "@github/copilot-sdk";

const perMillion = 1_000_000;

// `billing.tokenPrices` prices a batch of `batchSize` tokens; the port wants credits per million
// tokens. The prices are taken to be in AI Credits, which `models.listTokenPriceUnits` reports
// and S-01 confirms. A missing `batchSize` is read as one million.
export function toRuntimeModel(model: ModelInfo): RuntimeModel {
  const prices = model.billing?.tokenPrices;
  const contextWindow = model.capabilities.limits.max_context_window_tokens;
  const batchSize = prices?.batchSize;
  const scale = batchSize !== undefined && batchSize > 0 ? perMillion / batchSize : 1;
  return {
    id: model.id,
    name: model.name,
    ...(prices === undefined
      ? {}
      : {
          tokenPrices: {
            input: (prices.inputPrice ?? 0) * scale,
            cachedInput: (prices.cacheReadPrice ?? 0) * scale,
            output: (prices.outputPrice ?? 0) * scale,
          },
        }),
    ...(contextWindow > 0 ? { contextWindow } : {}),
  };
}

export function isModelUsable(model: ModelInfo): boolean {
  return model.policy?.state !== "disabled";
}

interface QuotaSnapshot {
  readonly isUnlimitedEntitlement: boolean;
  readonly entitlementRequests: number;
  readonly usedRequests: number;
  readonly resetDate?: string | undefined;
}

// The quota API still reports request counts per quota type. Until S-01 shows which type holds
// AI Credits, the first snapshot in this order is used.
const preferredQuotaTypes = ["ai_credits", "premium_interactions"];

export function toQuotaInfo(snapshots: Readonly<Record<string, QuotaSnapshot | undefined>>): QuotaInfo {
  const key = preferredQuotaTypes.find((type) => snapshots[type] !== undefined) ?? Object.keys(snapshots).sort()[0];
  const snapshot = key === undefined ? undefined : snapshots[key];
  if (snapshot === undefined) {
    return { usedCredits: 0, entitlementCredits: null, resetDate: null };
  }
  return {
    usedCredits: snapshot.usedRequests,
    entitlementCredits: snapshot.isUnlimitedEntitlement ? null : snapshot.entitlementRequests,
    resetDate: snapshot.resetDate ?? null,
  };
}
