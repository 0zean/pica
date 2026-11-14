import type { Tier } from "@pica/protocol";
import type { JsonObject } from "../json.ts";
import type { Result } from "../result.ts";
import type { StoreResult, UsageRecord, UsageRepository } from "../store/index.ts";
import { roundCredits } from "../usage/index.ts";

export interface UsageMetricAttributes {
  readonly agent: string;
  readonly model: string;
  readonly tier: Tier | "unknown";
}

export interface UsageMetricPoint {
  readonly attributes: UsageMetricAttributes;
  readonly calls: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly credits: number;
}

// Cumulative totals of the usage records written since the engine started, one point per
// agent, model and tier.
export interface UsageMeter {
  record(usage: UsageRecord): void;
  snapshot(): readonly UsageMetricPoint[];
}

export type MetricsExportErrorCode = "metrics.export_failed" | "metrics.rejected";

export interface MetricsExportError {
  readonly code: MetricsExportErrorCode;
  readonly message: string;
}

// Port for sending one OTLP `ExportMetricsServiceRequest`, encoded as JSON.
export interface MetricsTransport {
  send(body: string): Promise<Result<void, MetricsExportError>>;
}

export interface UsageMetricsRequestInput {
  readonly points: readonly UsageMetricPoint[];
  readonly startTime: string;
  readonly time: string;
  readonly serviceVersion?: string;
}

export const usageMetricNames = {
  calls: "pica.usage.calls",
  tokens: "pica.usage.tokens",
  credits: "pica.usage.credits",
} as const;

const cumulative = 2;

export function createUsageMeter(): UsageMeter {
  const points = new Map<string, UsageMetricPoint>();
  return {
    record: (usage) => {
      const attributes: UsageMetricAttributes = { agent: usage.agent, model: usage.model, tier: usage.tier ?? "unknown" };
      const key = JSON.stringify([attributes.agent, attributes.model, attributes.tier]);
      const previous = points.get(key);
      points.set(key, {
        attributes,
        calls: (previous?.calls ?? 0) + 1,
        inputTokens: (previous?.inputTokens ?? 0) + usage.inputTokens,
        cachedTokens: (previous?.cachedTokens ?? 0) + usage.cachedTokens,
        outputTokens: (previous?.outputTokens ?? 0) + usage.outputTokens,
        credits: (previous?.credits ?? 0) + usage.credits,
      });
    },
    snapshot: () => [...points.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, point]) => point),
  };
}

// Feeds the meter from the records the ledger writes, so exported metrics and the ledger agree.
export function meteredUsage(usage: UsageRepository, meter: UsageMeter): UsageRepository {
  return {
    record: (record): StoreResult<void> => {
      const written = usage.record(record);
      if (written.ok) {
        meter.record(record);
      }
      return written;
    },
    listBySession: (sessionId) => usage.listBySession(sessionId),
    rollup: (query) => usage.rollup(query),
  };
}

// OTLP/JSON encoding (opentelemetry-proto, metrics/v1): cumulative monotonic sums.
export function usageMetricsRequest(input: UsageMetricsRequestInput): JsonObject {
  const times = { startTimeUnixNano: unixNanos(input.startTime), timeUnixNano: unixNanos(input.time) };
  const resource = [stringAttribute("service.name", "picad")];
  if (input.serviceVersion !== undefined) {
    resource.push(stringAttribute("service.version", input.serviceVersion));
  }
  const tokenPoints = input.points.flatMap((point) => [
    intPoint(point, times, point.inputTokens, "input"),
    intPoint(point, times, point.cachedTokens, "cached_input"),
    intPoint(point, times, point.outputTokens, "output"),
  ]);
  return {
    resourceMetrics: [
      {
        resource: { attributes: resource },
        scopeMetrics: [
          {
            scope: { name: "pica.usage" },
            metrics: [
              sum(usageMetricNames.calls, "{call}", input.points.map((point) => intPoint(point, times, point.calls))),
              sum(usageMetricNames.tokens, "{token}", tokenPoints),
              sum(
                usageMetricNames.credits,
                "{credit}",
                input.points.map((point) => ({
                  attributes: attributes(point.attributes),
                  ...times,
                  asDouble: roundCredits(point.credits),
                })),
              ),
            ],
          },
        ],
      },
    ],
  };
}

interface PointTimes {
  readonly startTimeUnixNano: string;
  readonly timeUnixNano: string;
}

function sum(name: string, unit: string, dataPoints: readonly JsonObject[]): JsonObject {
  return { name, unit, sum: { aggregationTemporality: cumulative, isMonotonic: true, dataPoints } };
}

function intPoint(point: UsageMetricPoint, times: PointTimes, value: number, tokenType?: string): JsonObject {
  const extra = tokenType === undefined ? [] : [stringAttribute("pica.token.type", tokenType)];
  // OTLP/JSON writes 64-bit integers as decimal strings.
  return { attributes: [...attributes(point.attributes), ...extra], ...times, asInt: String(value) };
}

function attributes(source: UsageMetricAttributes): JsonObject[] {
  return [
    stringAttribute("pica.agent", source.agent),
    stringAttribute("pica.model", source.model),
    stringAttribute("pica.tier", source.tier),
  ];
}

function stringAttribute(key: string, value: string): JsonObject {
  return { key, value: { stringValue: value } };
}

function unixNanos(timestamp: string): string {
  const millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? (BigInt(millis) * 1_000_000n).toString() : "0";
}
