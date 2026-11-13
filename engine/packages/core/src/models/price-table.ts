import type { RuntimeModel, TokenPrices } from "../runtime/port.ts";
import type { CatalogModel } from "./types.ts";

export type PriceProvenance = "recorded" | "unverified";

export interface PriceTable {
  readonly provenance: PriceProvenance;
  readonly source: string;
  // Credits per million tokens, keyed by model id.
  readonly prices: Readonly<Record<string, TokenPrices>>;
}

export const emptyPriceTable: PriceTable = { provenance: "recorded", source: "none", prices: {} };

// Runtime prices always win; the table only fills in models the runtime lists without prices.
export function toCatalogModel(model: RuntimeModel, table: PriceTable): CatalogModel {
  const tablePrices = Object.hasOwn(table.prices, model.id) ? table.prices[model.id] : undefined;
  const prices = model.tokenPrices ?? tablePrices ?? null;
  const priceSource = model.tokenPrices !== undefined ? "runtime" : tablePrices !== undefined ? "table" : null;
  return {
    id: model.id,
    name: model.name,
    prices,
    priceSource,
    contextWindow: model.contextWindow ?? null,
  };
}
