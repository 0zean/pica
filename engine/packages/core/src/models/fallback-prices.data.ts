import type { PriceTable } from "./price-table.ts";

// UNVERIFIED DATA. These are not recorded from Copilot. They are the model providers' public API
// list prices converted to AI Credits (1 credit = $0.01) per million tokens, and are used only
// for models that `models.list` returns without `billing.tokenPrices`. Provenance and the plan to
// replace them with S-01's recorded list: docs/model-catalog.md.
export const fallbackPriceTable: PriceTable = {
  provenance: "unverified",
  source: "provider public API list prices; see docs/model-catalog.md",
  prices: {
    "gpt-5": { input: 125, cachedInput: 12.5, output: 1000 },
    "gpt-5-mini": { input: 25, cachedInput: 2.5, output: 200 },
    "gpt-4.1": { input: 200, cachedInput: 50, output: 800 },
    "claude-sonnet-4.5": { input: 300, cachedInput: 30, output: 1500 },
    "claude-haiku-4.5": { input: 100, cachedInput: 10, output: 500 },
  },
};
