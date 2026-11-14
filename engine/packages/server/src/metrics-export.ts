import { createUsageMeter, ok, usageMetricsRequest } from "@pica/core";
import type { MetricsExportError, MetricsTransport, Result, UsageMeter } from "@pica/core";
import type { Logger } from "./logger.ts";

export interface UsageMetricsExporterOptions {
  readonly transport: MetricsTransport;
  readonly clock?: () => string;
  readonly intervalMs?: number;
  readonly serviceVersion?: string;
}

// H-04: optional OTLP export of usage metrics. The engine creates none unless one is passed in.
export interface UsageMetricsExporter {
  readonly meter: UsageMeter;
  // Exports on an interval until `stop`; the timer does not keep the process alive.
  start(log: Logger): void;
  // Sends the current cumulative totals now; does nothing while no usage was recorded.
  flush(): Promise<Result<void, MetricsExportError>>;
  // Stops the interval and sends a last export.
  stop(): Promise<Result<void, MetricsExportError>>;
}

export const defaultMetricsIntervalMs = 60_000;

export function createUsageMetricsExporter(options: UsageMetricsExporterOptions): UsageMetricsExporter {
  const clock = options.clock ?? (() => new Date().toISOString());
  const startTime = clock();
  const meter = createUsageMeter();
  const timer: { handle?: ReturnType<typeof setInterval> } = {};

  const flush = async (): Promise<Result<void, MetricsExportError>> => {
    const points = meter.snapshot();
    if (points.length === 0) {
      return ok(undefined);
    }
    const request = usageMetricsRequest({
      points,
      startTime,
      time: clock(),
      ...(options.serviceVersion === undefined ? {} : { serviceVersion: options.serviceVersion }),
    });
    return options.transport.send(JSON.stringify(request));
  };

  return {
    meter,
    start: (log) => {
      if (timer.handle !== undefined) {
        return;
      }
      timer.handle = setInterval(() => {
        void flush().then((sent) => {
          if (!sent.ok) {
            log.warn(`usage metrics not exported (${sent.error.code}): ${sent.error.message}`);
          }
        });
      }, options.intervalMs ?? defaultMetricsIntervalMs);
      timer.handle.unref();
    },
    flush,
    stop: async () => {
      if (timer.handle !== undefined) {
        clearInterval(timer.handle);
        delete timer.handle;
      }
      return flush();
    },
  };
}
