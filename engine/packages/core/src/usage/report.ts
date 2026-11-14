import type { TokenPrices } from "../runtime/index.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import type { StoreError, UsageQuery, UsageRepository, UsageTotals } from "../store/index.ts";
import { estimateSavings, roundCredits } from "./savings.ts";
import type { SavingsEstimate } from "./savings.ts";
import type { UsageLedgerError } from "./ledger.ts";

export interface UsageSummary {
  readonly rows: readonly UsageTotals[];
  // Covers the same records as `rows`, whatever they are grouped by.
  readonly savings: SavingsEstimate;
}

export interface UsageReportOptions {
  readonly usage: Pick<UsageRepository, "rollup">;
  readonly reasoningPrices: () => TokenPrices | null;
}

export interface UsageReport {
  summarize(query: UsageQuery): Result<UsageSummary, StoreError | UsageLedgerError>;
}

export function createUsageReport(options: UsageReportOptions): UsageReport {
  return {
    summarize: (query) => {
      const rows = options.usage.rollup(query);
      if (!rows.ok) {
        return rows;
      }
      const tiers = options.usage.rollup({ ...query, groupBy: "tier" });
      if (!tiers.ok) {
        return tiers;
      }
      const worker = tiers.value.find((row) => row.key === "worker");
      const savings = estimateSavings(worker, options.reasoningPrices());
      if (!savings.ok) {
        return err({ code: "usage.invalid_usage", message: savings.error.message });
      }
      return ok({
        rows: rows.value.map((row) => ({ ...row, credits: roundCredits(row.credits) })),
        savings: savings.value,
      });
    },
  };
}
