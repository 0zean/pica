import { afterEach, describe, expect, it } from "vitest";
import { roundCredits, usageMetricNames } from "@pica/core";
import { createOtlpHttpTransport } from "@pica/adapters";
import { createUsageMetricsExporter } from "../../src/index.ts";
import type { UsageMetricsExporter } from "../../src/index.ts";
import { call } from "../sessions/helpers.ts";
import { runFixtureScenario, startFixtureEngine } from "./helpers.ts";
import type { FixtureEngine } from "./helpers.ts";

interface Attribute {
  readonly key: string;
  readonly value: { readonly stringValue: string };
}

interface DataPoint {
  readonly attributes: readonly Attribute[];
  readonly startTimeUnixNano: string;
  readonly timeUnixNano: string;
  readonly asInt?: string;
  readonly asDouble?: number;
}

interface Metric {
  readonly name: string;
  readonly unit: string;
  readonly sum: { readonly aggregationTemporality: number; readonly isMonotonic: boolean; readonly dataPoints: readonly DataPoint[] };
}

interface ExportRequest {
  readonly resourceMetrics: readonly {
    readonly resource: { readonly attributes: readonly Attribute[] };
    readonly scopeMetrics: readonly { readonly metrics: readonly Metric[] }[];
  }[];
}

interface Totals {
  key: string;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  credits: number;
}

interface Sent {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: ExportRequest;
}

const endpoint = "http://localhost:4318/v1/metrics";

let running: FixtureEngine | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function exportFixture(): Promise<{ readonly sent: Sent[]; readonly exporter: UsageMetricsExporter }> {
  const sent: Sent[] = [];
  const exporter = createUsageMetricsExporter({
    transport: createOtlpHttpTransport({
      endpoint,
      headers: { authorization: "Bearer collector-token" },
      fetch: (url, init) => {
        sent.push({
          url,
          headers: init.headers as Record<string, string>,
          body: JSON.parse(typeof init.body === "string" ? init.body : "null") as ExportRequest,
        });
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    }),
    clock: () => "2026-11-14T09:00:00.000Z",
    serviceVersion: "0.0.0",
  });
  running = await startFixtureEngine({ metricsExport: exporter });
  await runFixtureScenario(running.client);
  const flushed = await exporter.stop();
  expect(flushed.ok).toBe(true);
  return { sent, exporter };
}

function metric(request: ExportRequest, name: string): Metric {
  const found = request.resourceMetrics[0]?.scopeMetrics[0]?.metrics.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`metric ${name} missing`);
  }
  return found;
}

function attribute(point: DataPoint, key: string): string {
  const found = point.attributes.find((entry) => entry.key === key);
  if (found === undefined) {
    throw new Error(`attribute ${key} missing`);
  }
  return found.value.stringValue;
}

// Sums the exported points per value of one attribute, in the shape of a `usage.rollup` row.
function totalsBy(request: ExportRequest, key: "pica.agent" | "pica.model"): Totals[] {
  const rows = new Map<string, Totals>();
  const row = (point: DataPoint): Totals => {
    const name = attribute(point, key);
    const existing = rows.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created = { key: name, calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, credits: 0 };
    rows.set(name, created);
    return created;
  };
  for (const point of metric(request, usageMetricNames.calls).sum.dataPoints) {
    row(point).calls += Number(point.asInt);
  }
  const tokenField = { input: "inputTokens", cached_input: "cachedInputTokens", output: "outputTokens" } as const;
  for (const point of metric(request, usageMetricNames.tokens).sum.dataPoints) {
    const type = attribute(point, "pica.token.type") as keyof typeof tokenField;
    row(point)[tokenField[type]] += Number(point.asInt);
  }
  for (const point of metric(request, usageMetricNames.credits).sum.dataPoints) {
    const target = row(point);
    target.credits = roundCredits(target.credits + (point.asDouble ?? 0));
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

describe("usage metrics export", () => {
  it("exports per agent and per model exactly what the ledger rolls up", async () => {
    const { sent } = await exportFixture();
    expect(sent).toHaveLength(1);
    const request = sent[0]?.body;
    if (running === undefined || request === undefined) {
      throw new Error("nothing exported");
    }

    for (const [groupBy, key] of [
      ["agent", "pica.agent"],
      ["model", "pica.model"],
    ] as const) {
      const ledger = await call(running.client, "usage.rollup", { groupBy });
      expect(totalsBy(request, key)).toEqual(ledger["rows"]);
    }
    const bySession = await call(running.client, "usage.rollup", { groupBy: "session" });
    expect(bySession["rows"]).toEqual([
      expect.objectContaining({ calls: 4, inputTokens: 73500, cachedInputTokens: 10000, outputTokens: 2500 }),
    ]);
  });

  it("sends cumulative monotonic sums over OTLP/HTTP JSON with the configured headers", async () => {
    const { sent } = await exportFixture();
    const first = sent[0];
    expect(first?.url).toBe(endpoint);
    expect(first?.headers).toEqual({ authorization: "Bearer collector-token", "content-type": "application/json" });
    const resource = first?.body.resourceMetrics[0]?.resource.attributes;
    expect(resource).toEqual([
      { key: "service.name", value: { stringValue: "picad" } },
      { key: "service.version", value: { stringValue: "0.0.0" } },
    ]);
    for (const name of Object.values(usageMetricNames)) {
      const exported = first === undefined ? undefined : metric(first.body, name);
      expect(exported?.sum.aggregationTemporality).toBe(2);
      expect(exported?.sum.isMonotonic).toBe(true);
      expect(exported?.sum.dataPoints[0]?.startTimeUnixNano).toBe("1794646800000000000");
    }
  });

  it("sends nothing before any usage is recorded", async () => {
    const sent: string[] = [];
    const exporter = createUsageMetricsExporter({
      transport: { send: (body) => (sent.push(body), Promise.resolve({ ok: true, value: undefined })) },
    });
    expect((await exporter.flush()).ok).toBe(true);
    expect(sent).toEqual([]);
  });

  it("reports a collector rejection with a stable code", async () => {
    const transport = createOtlpHttpTransport({
      endpoint,
      fetch: () => Promise.resolve(new Response(null, { status: 503 })),
    });
    const sent = await transport.send("{}");
    expect(sent.ok ? undefined : sent.error.code).toBe("metrics.rejected");
    const unreachable = createOtlpHttpTransport({ endpoint, fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
    const failed = await unreachable.send("{}");
    expect(failed.ok ? undefined : failed.error).toEqual({ code: "metrics.export_failed", message: "ECONNREFUSED" });
  });
});
