import type { QuotaInfo, RuntimeModel } from "@pica/core";
import type { ModelInfo } from "@github/copilot-sdk";

const perMillion = 1_000_000;
const nanoAiuPerCredit = 1_000_000_000;

// The unit `models.listTokenPriceUnits` reports for a model's `billing.tokenPrices`.
export type PriceUnit = "ai_credits" | "nano_aiu";

// `billing.tokenPrices` prices a batch of `batchSize` tokens in `unit`; the port wants credits per
// million tokens. A missing `batchSize` is read as one million. Prices whose unit the runtime did
// not report are dropped, so the model shows "not available on this plan" instead of a price off
// by a factor of 10^9 (S-01, D-16).
export function toRuntimeModel(model: ModelInfo, unit: PriceUnit | undefined): RuntimeModel {
  const prices = unit === undefined ? undefined : model.billing?.tokenPrices;
  const contextWindow = model.capabilities.limits.max_context_window_tokens;
  const batchSize = prices?.batchSize;
  const scale = batchSize !== undefined && batchSize > 0 ? perMillion / batchSize : 1;
  // Divide rather than multiply by 10^-9, which is not exact in binary.
  const divisor = unit === "nano_aiu" ? nanoAiuPerCredit : 1;
  return {
    id: model.id,
    name: model.name,
    ...(prices === undefined
      ? {}
      : {
          tokenPrices: {
            input: ((prices.inputPrice ?? 0) * scale) / divisor,
            cachedInput: ((prices.cacheReadPrice ?? 0) * scale) / divisor,
            output: ((prices.outputPrice ?? 0) * scale) / divisor,
          },
        }),
    ...(contextWindow > 0 ? { contextWindow } : {}),
    supportsReasoningEffort: model.capabilities.supports.reasoningEffort,
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

// Only the `ai_credits` snapshot is a credit quota. The others (`chat`, `completions`,
// `premium_interactions`) count requests, so reading one as credits would show a working Free plan
// as "0 of 0 credits" (S-01).
const creditQuotaType = "ai_credits";

export function toQuotaInfo(snapshots: Readonly<Record<string, QuotaSnapshot | undefined>>): QuotaInfo | null {
  const snapshot = snapshots[creditQuotaType];
  if (snapshot === undefined) {
    return null;
  }
  return {
    usedCredits: snapshot.usedRequests,
    entitlementCredits: snapshot.isUnlimitedEntitlement ? null : snapshot.entitlementRequests,
    resetDate: snapshot.resetDate ?? null,
  };
}
