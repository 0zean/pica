import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import type { AgentRuntime } from "../runtime/port.ts";
import { toCatalogModel } from "./price-table.ts";
import type { PriceTable } from "./price-table.ts";
import type { CatalogModel, ModelCatalogError, ModelCatalogSnapshot, ModelCatalogWarning } from "./types.ts";

export interface ModelCatalogOptions {
  readonly runtime: Pick<AgentRuntime, "listModels">;
  readonly priceTable: PriceTable;
  // Epoch milliseconds.
  readonly now: () => number;
  // A snapshot older than this is refreshed on the next `get`.
  readonly maxAgeMs: number;
  // After a failed refresh, the next attempt waits at least this long.
  readonly retryAfterMs: number;
  readonly onWarning: (warning: ModelCatalogWarning) => void;
}

export type ModelCatalogResult = Result<ModelCatalogSnapshot, ModelCatalogError>;

export interface ModelCatalog {
  // The cached snapshot, refreshed first when it is stale. When a refresh fails and a previous
  // snapshot exists, that snapshot is returned and a warning is raised. Never throws.
  get(): Promise<ModelCatalogResult>;
  // Refreshes now, with the same fallback as `get`.
  refresh(): Promise<ModelCatalogResult>;
  current(): ModelCatalogSnapshot | undefined;
}

interface CatalogState {
  snapshot: ModelCatalogSnapshot | undefined;
  fetchedAtMs: number;
  lastFailureMs: number | undefined;
  inFlight: Promise<ModelCatalogResult> | undefined;
}

export function createModelCatalog(options: ModelCatalogOptions): ModelCatalog {
  const state: CatalogState = { snapshot: undefined, fetchedAtMs: 0, lastFailureMs: undefined, inFlight: undefined };

  const refresh = (): Promise<ModelCatalogResult> => {
    state.inFlight ??= fetchSnapshot(options, state).finally(() => {
      state.inFlight = undefined;
    });
    return state.inFlight;
  };

  return {
    get: async () => {
      if (state.snapshot !== undefined && !shouldRefresh(options, state)) return ok(state.snapshot);
      return refresh();
    },
    refresh,
    current: () => state.snapshot,
  };
}

function shouldRefresh(options: ModelCatalogOptions, state: CatalogState): boolean {
  const now = options.now();
  if (now - state.fetchedAtMs < options.maxAgeMs) return false;
  return state.lastFailureMs === undefined || now - state.lastFailureMs >= options.retryAfterMs;
}

async function fetchSnapshot(options: ModelCatalogOptions, state: CatalogState): Promise<ModelCatalogResult> {
  const listed = await options.runtime.listModels();
  const now = options.now();
  if (listed.ok) {
    const models: CatalogModel[] = listed.value.map((model) => toCatalogModel(model, options.priceTable));
    models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    state.snapshot = { models, fetchedAt: new Date(now).toISOString() };
    state.fetchedAtMs = now;
    state.lastFailureMs = undefined;
    return ok(state.snapshot);
  }
  state.lastFailureMs = now;
  const message = `models.list failed (${listed.error.code}): ${listed.error.message}`;
  if (state.snapshot === undefined) {
    return err({ code: "models.unavailable", message, runtimeCode: listed.error.code });
  }
  options.onWarning({
    code: "models.refresh_failed",
    message: `${message}; keeping the catalog fetched at ${state.snapshot.fetchedAt}`,
    at: new Date(now).toISOString(),
  });
  return ok(state.snapshot);
}
