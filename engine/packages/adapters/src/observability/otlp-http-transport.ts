import { err, ok } from "@pica/core";
import type { MetricsTransport } from "@pica/core";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OtlpHttpTransportOptions {
  // The full metrics URL, used as given (like OTEL_EXPORTER_OTLP_METRICS_ENDPOINT), e.g.
  // `http://localhost:4318/v1/metrics`.
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  // Tests pass a stub; the default is the global fetch.
  readonly fetch?: FetchLike;
}

export const defaultOtlpTimeoutMs = 10_000;

// OTLP/HTTP with the JSON encoding. Nothing is sent until `send` is called; the transport opens
// no connection when it is created.
export function createOtlpHttpTransport(options: OtlpHttpTransportOptions): MetricsTransport {
  const send = options.fetch ?? fetch;
  return {
    send: async (body) => {
      try {
        const response = await send(options.endpoint, {
          method: "POST",
          headers: { ...options.headers, "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(options.timeoutMs ?? defaultOtlpTimeoutMs),
        });
        if (!response.ok) {
          return err({ code: "metrics.rejected", message: `collector answered HTTP ${String(response.status)}` });
        }
        return ok(undefined);
      } catch (thrown) {
        return err({ code: "metrics.export_failed", message: thrown instanceof Error ? thrown.message : String(thrown) });
      }
    },
  };
}
