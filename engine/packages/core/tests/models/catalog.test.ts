import { describe, expect, it } from "vitest";
import { createModelCatalog, emptyPriceTable, err, ok } from "../../src/index.ts";
import type {
  AgentRuntime,
  ModelCatalogOptions,
  ModelCatalogWarning,
  PriceTable,
  RuntimeError,
  RuntimeModel,
  RuntimeResult,
} from "../../src/index.ts";

type ListResponse = readonly RuntimeModel[] | RuntimeError;

// Answers each `listModels` call with the next scripted response and counts the calls.
class ScriptedRuntime implements Pick<AgentRuntime, "listModels"> {
  calls = 0;
  private readonly responses: ListResponse[];

  constructor(responses: readonly ListResponse[]) {
    this.responses = [...responses];
  }

  listModels(): RuntimeResult<readonly RuntimeModel[]> {
    this.calls += 1;
    const next = this.responses.shift();
    if (next === undefined) throw new Error("no scripted response left");
    return Promise.resolve("code" in next ? err(next) : ok(next));
  }
}

const start = Date.parse("2026-11-13T09:00:00.000Z");
const minute = 60_000;
const firstList: readonly RuntimeModel[] = [
  { id: "worker-1", name: "Worker 1", tokenPrices: { input: 15, cachedInput: 1.5, output: 60 } },
  { id: "frontier-1", name: "Frontier 1", tokenPrices: { input: 125, cachedInput: 12.5, output: 1000 }, contextWindow: 200_000 },
];
const secondList: readonly RuntimeModel[] = [
  { id: "frontier-2", name: "Frontier 2", tokenPrices: { input: 300, cachedInput: 30, output: 1500 } },
];
const outage: RuntimeError = { code: "runtime.failed", message: "connection reset" };

function setup(responses: readonly ListResponse[], overrides: Partial<ModelCatalogOptions> = {}) {
  const runtime = new ScriptedRuntime(responses);
  const clock = { now: start };
  const warnings: ModelCatalogWarning[] = [];
  const catalog = createModelCatalog({
    runtime,
    priceTable: emptyPriceTable,
    now: () => clock.now,
    maxAgeMs: 10 * minute,
    retryAfterMs: minute,
    onWarning: (warning) => warnings.push(warning),
    ...overrides,
  });
  return { runtime, clock, warnings, catalog };
}

function ids(result: Awaited<ReturnType<ReturnType<typeof setup>["catalog"]["get"]>>): readonly string[] {
  return result.ok ? result.value.models.map((model) => model.id) : [];
}

describe("model catalog cache", () => {
  it("fetches once and serves a fresh snapshot from the cache", async () => {
    const { runtime, clock, catalog } = setup([firstList]);
    const first = await catalog.get();
    clock.now += 10 * minute - 1;
    const second = await catalog.get();

    expect(runtime.calls).toBe(1);
    expect(first).toEqual(second);
    expect(first).toEqual(
      ok({
        fetchedAt: "2026-11-13T09:00:00.000Z",
        models: [
          {
            id: "frontier-1",
            name: "Frontier 1",
            prices: { input: 125, cachedInput: 12.5, output: 1000 },
            priceSource: "runtime",
            contextWindow: 200_000,
          },
          {
            id: "worker-1",
            name: "Worker 1",
            prices: { input: 15, cachedInput: 1.5, output: 60 },
            priceSource: "runtime",
            contextWindow: null,
          },
        ],
      }),
    );
  });

  it("refreshes a stale snapshot", async () => {
    const { runtime, clock, catalog, warnings } = setup([firstList, secondList]);
    await catalog.get();
    clock.now += 10 * minute;
    const refreshed = await catalog.get();

    expect(runtime.calls).toBe(2);
    expect(ids(refreshed)).toEqual(["frontier-2"]);
    expect(refreshed.ok && refreshed.value.fetchedAt).toBe("2026-11-13T09:10:00.000Z");
    expect(warnings).toEqual([]);
  });

  it("keeps the previous catalog and raises a warning when a refresh fails", async () => {
    const { runtime, clock, catalog, warnings } = setup([firstList, outage]);
    const first = await catalog.get();
    clock.now += 15 * minute;
    const afterFailure = await catalog.get();

    expect(runtime.calls).toBe(2);
    expect(afterFailure).toEqual(first);
    expect(catalog.current()).toEqual(first.ok ? first.value : undefined);
    expect(warnings).toEqual([
      {
        code: "models.refresh_failed",
        message:
          "models.list failed (runtime.failed): connection reset; keeping the catalog fetched at 2026-11-13T09:00:00.000Z",
        at: "2026-11-13T09:15:00.000Z",
      },
    ]);
  });

  it("waits retryAfterMs after a failure, then recovers", async () => {
    const { runtime, clock, catalog, warnings } = setup([firstList, outage, secondList]);
    await catalog.get();
    clock.now += 15 * minute;
    await catalog.get();
    clock.now += minute - 1;
    await catalog.get();
    expect(runtime.calls).toBe(2);

    clock.now += 1;
    const recovered = await catalog.get();
    expect(runtime.calls).toBe(3);
    expect(ids(recovered)).toEqual(["frontier-2"]);
    expect(warnings).toHaveLength(1);
  });

  it("reports an error when the first fetch fails", async () => {
    const { catalog, warnings } = setup([{ code: "runtime.auth_missing", message: "not signed in" }]);
    expect(await catalog.get()).toEqual(
      err({
        code: "models.unavailable",
        message: "models.list failed (runtime.auth_missing): not signed in",
        runtimeCode: "runtime.auth_missing",
      }),
    );
    expect(catalog.current()).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("shares one in-flight fetch between concurrent callers", async () => {
    const { runtime, catalog } = setup([firstList]);
    const [a, b, c] = await Promise.all([catalog.get(), catalog.get(), catalog.refresh()]);
    expect(runtime.calls).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("refresh() fetches even when the snapshot is fresh", async () => {
    const { runtime, catalog } = setup([firstList, secondList]);
    await catalog.get();
    expect(ids(await catalog.refresh())).toEqual(["frontier-2"]);
    expect(runtime.calls).toBe(2);
  });

  it("fills prices from the table only where the runtime gives none", async () => {
    const table: PriceTable = {
      provenance: "unverified",
      source: "test",
      prices: {
        "listed-unpriced": { input: 1, cachedInput: 0.1, output: 4 },
        "frontier-1": { input: 9, cachedInput: 9, output: 9 },
      },
    };
    const { catalog } = setup(
      [
        [
          firstList[1] as RuntimeModel,
          { id: "listed-unpriced", name: "Listed" },
          { id: "unknown", name: "Unknown" },
        ],
      ],
      { priceTable: table },
    );
    const result = await catalog.get();
    const byId = new Map((result.ok ? result.value.models : []).map((model) => [model.id, model]));

    expect(byId.get("frontier-1")).toMatchObject({ prices: firstList[1]?.tokenPrices, priceSource: "runtime" });
    expect(byId.get("listed-unpriced")).toMatchObject({ prices: table.prices["listed-unpriced"], priceSource: "table" });
    expect(byId.get("unknown")).toMatchObject({ prices: null, priceSource: null });
  });
});
