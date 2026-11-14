import { computeCredits } from "../models/index.ts";
import type { ModelCatalogError } from "../models/index.ts";
import { ok } from "../result.ts";
import type { Result } from "../result.ts";
import type { TokenPrices } from "../runtime/index.ts";
import type { UsageTotals } from "../store/index.ts";

export interface SavingsEstimate {
  readonly estimated: true;
  readonly credits: number;
}

// What worker-tier calls would have cost at the reasoning tier's rates, minus what they cost
// (PLAN.md §5.6). Always an estimate: a reasoning model would not have used the same tokens.
// Without reasoning prices there is nothing to compare against, so the estimate is zero.
export function estimateSavings(
  worker: UsageTotals | undefined,
  reasoningPrices: TokenPrices | null,
): Result<SavingsEstimate, ModelCatalogError> {
  if (worker === undefined || reasoningPrices === null) {
    return ok({ estimated: true, credits: 0 });
  }
  const repriced = computeCredits(
    { inputTokens: worker.inputTokens, cachedInputTokens: worker.cachedTokens, outputTokens: worker.outputTokens },
    reasoningPrices,
  );
  if (!repriced.ok) {
    return repriced;
  }
  return ok({ estimated: true, credits: roundCredits(repriced.value.total - worker.credits) });
}

// Sums of stored credits are doubles; nine decimal places is far below a displayed credit.
export function roundCredits(credits: number): number {
  return Math.round(credits * 1e9) / 1e9;
}
