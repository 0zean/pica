import { describe, expect, it } from "vitest";
import { computeCredits, computeModelCredits } from "../../src/index.ts";
import type { CatalogModel, CreditBreakdown, TokenPrices, TokenUsageCounts } from "../../src/index.ts";

// Prices are the E-09 replay fixtures' `frontier-1` and `worker-1` after conversion to credits per
// million tokens. Expected credits are worked by hand: tokens × rate ÷ 1,000,000.
const frontier: TokenPrices = { input: 125, cachedInput: 12.5, output: 1000 };
const worker: TokenPrices = { input: 15, cachedInput: 1.5, output: 60 };

interface Case {
  readonly name: string;
  readonly usage: TokenUsageCounts;
  readonly prices: TokenPrices;
  readonly expected: CreditBreakdown;
}

const cases: readonly Case[] = [
  {
    name: "frontier call",
    usage: { inputTokens: 12_345, cachedInputTokens: 67_890, outputTokens: 4_321 },
    prices: frontier,
    expected: { input: 1.543125, cachedInput: 0.848625, output: 4.321, total: 6.71275 },
  },
  {
    name: "worker call",
    usage: { inputTokens: 200_000, cachedInputTokens: 1_500_000, outputTokens: 30_000 },
    prices: worker,
    expected: { input: 3, cachedInput: 2.25, output: 1.8, total: 7.05 },
  },
  {
    name: "a single token of each kind",
    usage: { inputTokens: 1, cachedInputTokens: 1, outputTokens: 1 },
    prices: worker,
    expected: { input: 0.000015, cachedInput: 0.0000015, output: 0.00006, total: 0.0000765 },
  },
  {
    name: "a total that naive float addition gets wrong (0.1 + 0.2)",
    usage: { inputTokens: 1, cachedInputTokens: 1, outputTokens: 0 },
    prices: { input: 100_000, cachedInput: 200_000, output: 0 },
    expected: { input: 0.1, cachedInput: 0.2, output: 0, total: 0.3 },
  },
  {
    name: "fractional rates",
    usage: { inputTokens: 3, cachedInputTokens: 7, outputTokens: 11 },
    prices: { input: 0.3, cachedInput: 0.075, output: 2.4 },
    expected: { input: 0.0000009, cachedInput: 0.000000525, output: 0.0000264, total: 0.000027825 },
  },
  {
    name: "ledger-scale totals beyond 2^53 micro-units",
    usage: { inputTokens: 2_000_000_000, cachedInputTokens: 9_000_000_000, outputTokens: 1_000_000_000 },
    prices: { input: 300, cachedInput: 30, output: 1500 },
    expected: { input: 600_000, cachedInput: 270_000, output: 1_500_000, total: 2_370_000 },
  },
  {
    name: "no usage",
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    prices: frontier,
    expected: { input: 0, cachedInput: 0, output: 0, total: 0 },
  },
];

describe("computeCredits", () => {
  it.each(cases)("$name", ({ usage, prices, expected }) => {
    expect(computeCredits(usage, prices)).toStrictEqual({ ok: true, value: expected });
  });

  it.each([
    { inputTokens: -1, cachedInputTokens: 0, outputTokens: 0 },
    { inputTokens: 0, cachedInputTokens: 1.5, outputTokens: 0 },
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: Number.NaN },
  ])("rejects invalid token counts %o", (usage) => {
    const result = computeCredits(usage, frontier);
    expect(result.ok ? undefined : result.error.code).toBe("models.invalid_usage");
  });

  it("rejects a negative price", () => {
    const result = computeCredits({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 }, { ...frontier, input: -1 });
    expect(result.ok ? undefined : result.error.code).toBe("models.invalid_usage");
  });
});

describe("computeModelCredits", () => {
  const usage: TokenUsageCounts = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 0 };

  it("prices usage with the model's rates", () => {
    const model: CatalogModel = { id: "m", name: "m", prices: worker, priceSource: "table", contextWindow: null };
    expect(computeModelCredits(usage, model)).toStrictEqual({
      ok: true,
      value: { input: 0.00015, cachedInput: 0, output: 0, total: 0.00015 },
    });
  });

  it("reports a model with no known prices", () => {
    const model: CatalogModel = { id: "m", name: "m", prices: null, priceSource: null, contextWindow: null };
    const result = computeModelCredits(usage, model);
    expect(result.ok ? undefined : result.error.code).toBe("models.price_unknown");
  });
});
