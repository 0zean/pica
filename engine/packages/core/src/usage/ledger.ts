import type { Tier } from "@pica/protocol";
import type { EventDraftOf, EventLog } from "../events/index.ts";
import { computeCredits } from "../models/index.ts";
import type { TokenPrices } from "../runtime/index.ts";
import type { StoreErrorCode, UsageRepository } from "../store/index.ts";

export interface UsagePricing {
  // The model's prices at the time of the call; null when they are unknown.
  pricesFor(model: string): TokenPrices | null;
  tierOf(agent: string): Tier | null;
}

export type UsageLedgerErrorCode = StoreErrorCode | "usage.price_unknown" | "usage.invalid_usage";

export interface UsageLedgerError {
  readonly code: UsageLedgerErrorCode;
  readonly message: string;
}

export interface UsageLedgerOptions {
  readonly usage: UsageRepository;
  readonly pricing: UsagePricing;
  // The event is logged even when its record cannot be priced or stored; this reports why.
  readonly onError?: (error: UsageLedgerError) => void;
}

type UsageDraft = EventDraftOf<"usage.recorded">;

// Prices every unbilled `usage.recorded` event on its way into the log and writes its `UsageRecord`
// (PLAN.md §5.6), so the ledger and the timeline always show the same credits.
export function withUsageLedger(log: EventLog, options: UsageLedgerOptions): EventLog {
  const report = options.onError ?? (() => undefined);
  return {
    subscribe: (sessionId, afterSeq, listener) => log.subscribe(sessionId, afterSeq, listener),
    append: (sessionId, draft) => {
      if (draft.type !== "usage.recorded") {
        return log.append(sessionId, draft);
      }
      const priced = price(draft, options.pricing, report);
      const appended = log.append(sessionId, priced);
      if (appended.ok) {
        const { payload } = priced;
        const stored = options.usage.record({
          sessionId,
          agent: payload.agent,
          model: payload.model,
          inputTokens: payload.inputTokens,
          cachedTokens: payload.cachedInputTokens,
          outputTokens: payload.outputTokens,
          credits: payload.credits,
          tier: options.pricing.tierOf(payload.agent),
          timestamp: payload.timestamp,
        });
        if (!stored.ok) {
          report(stored.error);
        }
      }
      return appended;
    },
  };
}

// A call that arrives with credits was billed that amount by the runtime, which is the true cost on
// every plan and the only one on plans without token prices (S-03). Otherwise it is priced here.
function price(draft: UsageDraft, pricing: UsagePricing, report: (error: UsageLedgerError) => void): UsageDraft {
  if (draft.payload.credits > 0) {
    return draft;
  }
  const prices = pricing.pricesFor(draft.payload.model);
  if (prices === null) {
    report({ code: "usage.price_unknown", message: `no token prices are known for model "${draft.payload.model}"` });
    return draft;
  }
  const credits = computeCredits(draft.payload, prices);
  if (!credits.ok) {
    report({ code: "usage.invalid_usage", message: credits.error.message });
    return draft;
  }
  return { ...draft, payload: { ...draft.payload, credits: credits.value.total } };
}
