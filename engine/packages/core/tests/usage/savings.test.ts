import { describe, expect, it } from "vitest";
import { agentTier, createUsageReport, estimateSavings, ok, withUsageLedger } from "@pica/core";
import type { EventLog, TokenPrices, UsageLedgerError, UsageRecord, UsageTotals } from "@pica/core";

const reasoning: TokenPrices = { input: 300, cachedInput: 30, output: 1500 };

function totals(key: string, tokens: readonly [number, number, number], credits: number): UsageTotals {
  const [inputTokens, cachedTokens, outputTokens] = tokens;
  return { key, calls: 1, inputTokens, cachedTokens, outputTokens, credits };
}

describe("savings estimate", () => {
  // Worker tokens 120000 input, 40000 cached, 6000 output, which cost 3.4 credits.
  // At reasoning rates: 120000 × 300e-6 = 36, 40000 × 30e-6 = 1.2, 6000 × 1500e-6 = 9; 46.2 − 3.4 = 42.8.
  it("reprices worker-tier tokens at the reasoning rate and subtracts what they cost", () => {
    expect(estimateSavings(totals("worker", [120000, 40000, 6000], 3.4), reasoning)).toEqual(
      ok({ estimated: true, credits: 42.8 }),
    );
  });

  it("is negative when the worker tier costs more", () => {
    expect(estimateSavings(totals("worker", [1000, 0, 0], 0.5), reasoning)).toEqual(
      ok({ estimated: true, credits: -0.2 }),
    );
  });

  it("is zero without worker usage or reasoning prices", () => {
    expect(estimateSavings(undefined, reasoning)).toEqual(ok({ estimated: true, credits: 0 }));
    expect(estimateSavings(totals("worker", [1000, 0, 0], 0.5), null)).toEqual(ok({ estimated: true, credits: 0 }));
  });

  it("covers only the worker rows of the report's query", () => {
    const queries: unknown[] = [];
    const report = createUsageReport({
      usage: {
        rollup: (query) => {
          queries.push(query);
          return ok(
            query.groupBy === "tier"
              ? [totals("reasoning", [500000, 0, 9000], 163.5), totals("worker", [120000, 40000, 6000], 3.4)]
              : [totals("model-r", [500000, 0, 9000], 163.5)],
          );
        },
      },
      reasoningPrices: () => reasoning,
    });
    const summary = report.summarize({ groupBy: "model", workspaceId: "ws-1" });
    expect(summary.ok && summary.value.savings).toEqual({ estimated: true, credits: 42.8 });
    expect(queries).toEqual([
      { groupBy: "model", workspaceId: "ws-1" },
      { groupBy: "tier", workspaceId: "ws-1" },
    ]);
  });
});

describe("agent tiers", () => {
  it("make the root agent reasoning-tier and other agents their definition's tier, else worker", () => {
    const tierOf = agentTier({ rootAgent: "main", agents: [{ name: "architect", tier: "reasoning" }] });
    expect(["main", "architect", "bulk-reader"].map(tierOf)).toEqual(["reasoning", "reasoning", "worker"]);
  });
});

describe("usage ledger", () => {
  const draft = {
    type: "usage.recorded" as const,
    timestamp: "2026-11-13T09:00:00.000Z",
    payload: {
      sessionId: "s-1",
      agent: "main",
      model: "model-unknown",
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 1,
      credits: 0,
      timestamp: "2026-11-13T09:00:00.000Z",
    },
  };
  const echo: EventLog = {
    append: (sessionId, appended) => ok({ ...appended, sessionId, seq: 1 }),
    subscribe: () => ({ close: () => undefined }),
  };

  it("logs and records an unpriced call at zero credits and reports why", () => {
    const recorded: UsageRecord[] = [];
    const errors: UsageLedgerError[] = [];
    const log = withUsageLedger(echo, {
      usage: {
        record: (record) => {
          recorded.push(record);
          return ok(undefined);
        },
        listBySession: () => ok([]),
        rollup: () => ok([]),
      },
      pricing: { pricesFor: () => null, tierOf: () => "reasoning" },
      onError: (error) => errors.push(error),
    });
    expect(log.append("s-1", draft).ok).toBe(true);
    expect(recorded.map((record) => [record.credits, record.tier])).toEqual([[0, "reasoning"]]);
    expect(errors.map((error) => error.code)).toEqual(["usage.price_unknown"]);
  });
});
