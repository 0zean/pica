import type { UsageReport } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { MethodRouter } from "./router.ts";

export function registerUsageHandlers(router: MethodRouter, report: UsageReport): void {
  router.register("usage.rollup", (params) => {
    const summary = report.summarize(params);
    if (!summary.ok) {
      throw new RpcFailure("internal_error", summary.error.message, { reason: summary.error.code });
    }
    return {
      rows: summary.value.rows.map((row) => ({
        key: row.key,
        calls: row.calls,
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedTokens,
        outputTokens: row.outputTokens,
        credits: row.credits,
      })),
      savings: summary.value.savings,
    };
  });
}
