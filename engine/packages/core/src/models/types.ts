import type { Tier } from "@pica/protocol";
import type { RuntimeErrorCode } from "../runtime/errors.ts";
import type { TokenPrices } from "../runtime/port.ts";

export type ModelTier = Tier;

// Where a model's prices came from: the runtime's `models.list` billing, or the fallback table.
export type PriceSource = "runtime" | "table";

export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  readonly prices: TokenPrices | null;
  readonly priceSource: PriceSource | null;
  readonly contextWindow: number | null;
}

export interface ModelCatalogSnapshot {
  readonly models: readonly CatalogModel[];
  readonly fetchedAt: string;
}

// Organization restrictions on models, compiled from the managed policy file (H-01).
// A model is allowed when it is not in `deny` and, if `allow` is given, is in `allow`.
export interface ManagedModelPolicy {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export const modelCatalogErrorCodes = ["models.unavailable", "models.price_unknown", "models.invalid_usage"] as const;
export type ModelCatalogErrorCode = (typeof modelCatalogErrorCodes)[number];

export interface ModelCatalogError {
  readonly code: ModelCatalogErrorCode;
  readonly message: string;
  readonly runtimeCode?: RuntimeErrorCode;
}

// Shaped like the protocol's `engine.warning` notification so the server can forward it as is.
export interface ModelCatalogWarning {
  readonly code: "models.refresh_failed";
  readonly message: string;
  readonly at: string;
}
