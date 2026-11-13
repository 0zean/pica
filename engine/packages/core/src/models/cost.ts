import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import type { TokenPrices } from "../runtime/port.ts";
import type { CatalogModel, ModelCatalogError } from "./types.ts";

// `inputTokens` excludes cached input; the runtime reports cache reads separately (docs/copilot-replay.md).
export interface TokenUsageCounts {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

export interface CreditBreakdown {
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
  readonly total: number;
}

// Prices are held as integer micro-credits per million tokens, so each product is an exact
// integer in units of 1e-12 credits. Every figure is rounded to a double once, at the end, and
// `total` is rounded from the exact sum rather than summed from rounded parts.
const priceScale = 1_000_000;
const fractionDigits = 12;
const unitsPerCredit = 10n ** BigInt(fractionDigits);

export function computeCredits(
  usage: TokenUsageCounts,
  prices: TokenPrices,
): Result<CreditBreakdown, ModelCatalogError> {
  const counts = [usage.inputTokens, usage.cachedInputTokens, usage.outputTokens];
  if (!counts.every((count) => Number.isSafeInteger(count) && count >= 0)) {
    return err({ code: "models.invalid_usage", message: "token counts must be non-negative integers" });
  }
  const rates = [prices.input, prices.cachedInput, prices.output];
  if (!rates.every((rate) => Number.isFinite(rate) && rate >= 0)) {
    return err({ code: "models.invalid_usage", message: "token prices must be non-negative numbers" });
  }
  const input = units(usage.inputTokens, prices.input);
  const cachedInput = units(usage.cachedInputTokens, prices.cachedInput);
  const output = units(usage.outputTokens, prices.output);
  return ok({
    input: toCredits(input),
    cachedInput: toCredits(cachedInput),
    output: toCredits(output),
    total: toCredits(input + cachedInput + output),
  });
}

export function computeModelCredits(
  usage: TokenUsageCounts,
  model: CatalogModel,
): Result<CreditBreakdown, ModelCatalogError> {
  if (model.prices === null) {
    return err({ code: "models.price_unknown", message: `no token prices are known for model "${model.id}"` });
  }
  return computeCredits(usage, model.prices);
}

function units(tokens: number, creditsPerMillion: number): bigint {
  return BigInt(tokens) * BigInt(Math.round(creditsPerMillion * priceScale));
}

function toCredits(value: bigint): number {
  const whole = value / unitsPerCredit;
  const fraction = (value % unitsPerCredit).toString().padStart(fractionDigits, "0");
  return Number(`${whole.toString()}.${fraction}`);
}
