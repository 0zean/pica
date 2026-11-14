import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUsageReport } from "@pica/core";
import type { Store, UsageGrouping, UsageQuery, UsageRecord } from "@pica/core";
import { sampleSession, seedStore, value, withTempDir } from "./helpers.ts";

function usage(
  sessionId: string,
  agent: string,
  model: string,
  tokens: readonly [number, number, number],
  credits: number,
  timestamp: string,
): UsageRecord {
  const [inputTokens, cachedTokens, outputTokens] = tokens;
  const tier = agent === "main" ? "reasoning" : "worker";
  return { sessionId, agent, model, inputTokens, cachedTokens, outputTokens, credits, tier, timestamp };
}

// ws-1 holds s-1 and s-2; ws-2 holds s-3. Record 3 is 23:30 on the 12th at -02:00, so the 13th in UTC.
const records = [
  usage("s-1", "main", "model-r", [1000, 0, 100], 0.5, "2026-11-12T10:00:00.000Z"),
  usage("s-1", "bulk-reader", "model-w", [4000, 0, 50], 0.1, "2026-11-12T10:05:00.000Z"),
  usage("s-2", "main", "model-r", [2000, 500, 200], 1.0, "2026-11-12T23:30:00.000-02:00"),
  usage("s-2", "repo-scout", "model-w", [3000, 1000, 20], 0.2, "2026-11-13T09:00:00.000Z"),
  usage("s-3", "main", "model-x", [500, 0, 10], 0.25, "2026-11-14T00:00:00.000Z"),
];

function row(key: string, calls: number, tokens: readonly [number, number, number], credits: number): unknown {
  const [inputTokens, cachedTokens, outputTokens] = tokens;
  return { key, calls, inputTokens, cachedTokens, outputTokens, credits };
}

const expected: Record<Exclude<UsageGrouping, "tier">, unknown[]> = {
  session: [row("s-1", 2, [5000, 0, 150], 0.6), row("s-2", 2, [5000, 1500, 220], 1.2), row("s-3", 1, [500, 0, 10], 0.25)],
  agent: [
    row("bulk-reader", 1, [4000, 0, 50], 0.1),
    row("main", 3, [3500, 500, 310], 1.75),
    row("repo-scout", 1, [3000, 1000, 20], 0.2),
  ],
  model: [row("model-r", 2, [3000, 500, 300], 1.5), row("model-w", 2, [7000, 1000, 70], 0.3), row("model-x", 1, [500, 0, 10], 0.25)],
  workspace: [row("ws-1", 4, [10000, 1500, 370], 1.8), row("ws-2", 1, [500, 0, 10], 0.25)],
  day: [
    row("2026-11-12", 2, [5000, 0, 150], 0.6),
    row("2026-11-13", 2, [5000, 1500, 220], 1.2),
    row("2026-11-14", 1, [500, 0, 10], 0.25),
  ],
};

describe("usage rollups", () => {
  let store: Store;
  let cleanup = (): void => undefined;

  beforeEach(() => {
    const temp = withTempDir();
    cleanup = temp.cleanup;
    store = seedStore(`${temp.dir}/pica.db`, ["s-1", "s-2"]);
    value(store.workspaces.save({ id: "ws-2", name: "Search", sources: [], pinnedRepoIds: [], settingsOverrides: {} }));
    value(store.sessions.create({ ...sampleSession("s-3"), workspaceId: "ws-2" }));
    for (const record of records) {
      value(store.usage.record(record));
    }
  });

  afterEach(() => {
    store.close();
    cleanup();
  });

  function rows(query: UsageQuery): unknown {
    const summary = createUsageReport({ usage: store.usage, reasoningPrices: () => null }).summarize(query);
    if (!summary.ok) {
      throw new Error(summary.error.message);
    }
    return summary.value.rows;
  }

  it.each(Object.entries(expected))("group by %s", (groupBy, expectedRows) => {
    expect(rows({ groupBy: groupBy as UsageGrouping })).toEqual(expectedRows);
  });

  it("group by tier, naming records without one unknown", () => {
    value(store.usage.record({ ...usage("s-1", "main", "model-r", [10, 0, 1], 0.01, "2026-11-12T11:00:00.000Z"), tier: null }));
    expect(rows({ groupBy: "tier" })).toEqual([
      row("reasoning", 3, [3500, 500, 310], 1.75),
      row("unknown", 1, [10, 0, 1], 0.01),
      row("worker", 2, [7000, 1000, 70], 0.3),
    ]);
  });

  it("filter by workspace and by session", () => {
    expect(rows({ groupBy: "session", workspaceId: "ws-1" })).toEqual(expected.session.slice(0, 2));
    expect(rows({ groupBy: "agent", sessionId: "s-2" })).toEqual([
      row("main", 1, [2000, 500, 200], 1.0),
      row("repo-scout", 1, [3000, 1000, 20], 0.2),
    ]);
    expect(rows({ groupBy: "model", workspaceId: "missing" })).toEqual([]);
  });

  it("filter by a half-open time range compared as instants", () => {
    const utc = { from: "2026-11-13T00:00:00.000Z", to: "2026-11-14T00:00:00.000Z" };
    const offset = { from: "2026-11-12T22:00:00.000-02:00", to: "2026-11-13T21:00:00.000-03:00" };
    expect(rows({ groupBy: "day", ...utc })).toEqual([expected.day[1]]);
    expect(rows({ groupBy: "day", ...offset })).toEqual([expected.day[1]]);
    expect(rows({ groupBy: "day", from: "2026-11-14T00:00:00.000Z" })).toEqual([expected.day[2]]);
  });
});
