import { err, ok } from "../result.ts";
import type { UsageRepository } from "../store/index.ts";
import type { SessionResult } from "./errors.ts";

// `budget.*` in config (PLAN.md §4.6). The session limit is enforced by the runtime as a soft cap
// (`maxAiCredits`); the workspace daily cap is enforced here, when a session starts or resumes.
export interface BudgetSettings {
  // The limit for a session created without one.
  readonly sessionCredits?: number | undefined;
  readonly workspaceDailyCredits?: number | undefined;
  // Fractions of the session limit at which `budget.warning` is emitted, once each per limit.
  readonly warningThresholds?: readonly number[] | undefined;
  // The managed ceiling (H-01): no session limit, requested or raised, may exceed it.
  readonly maxSessionCredits?: number | undefined;
}

export function withinSessionCeiling(credits: number | undefined, settings: BudgetSettings | undefined): number | undefined {
  const ceiling = settings?.maxSessionCredits;
  if (ceiling === undefined) {
    return credits;
  }
  return credits === undefined ? ceiling : Math.min(credits, ceiling);
}

export const defaultWarningThresholds: readonly number[] = [0.75, 0.9];

export interface BudgetWarning {
  readonly spentCredits: number;
  readonly limitCredits: number;
}

export interface SessionBudget {
  spent(): number;
  limit(): number | null;
  // Adds one model call's credits and returns the warnings it crossed.
  record(credits: number): readonly BudgetWarning[];
  raise(limitCredits: number): void;
}

export function createSessionBudget(
  limitCredits: number | null,
  spentCredits: number,
  thresholds: readonly number[] = defaultWarningThresholds,
): SessionBudget {
  let limit = limitCredits;
  let spent = spentCredits;
  const warned = new Set<number>();
  const crossed = (): number[] =>
    limit === null ? [] : thresholds.filter((fraction) => !warned.has(fraction) && spent >= fraction * (limit ?? 0));
  const markCrossed = (): void => {
    for (const fraction of crossed()) {
      warned.add(fraction);
    }
  };
  markCrossed();
  return {
    spent: () => spent,
    limit: () => limit,
    record: (credits) => {
      spent += credits;
      const newly = crossed();
      markCrossed();
      return limit === null || newly.length === 0 ? [] : [{ spentCredits: spent, limitCredits: limit }];
    },
    raise: (limitCredits) => {
      limit = limitCredits;
      warned.clear();
      markCrossed();
    },
  };
}

// UTC calendar days, as the usage rollups use (core/src/store/entities.ts).
export function utcDay(now: string): { readonly from: string; readonly to: string } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function checkWorkspaceDailyCap(
  usage: Pick<UsageRepository, "rollup">,
  workspaceId: string,
  capCredits: number,
  now: string,
): SessionResult<undefined> {
  const day = utcDay(now);
  const totals = usage.rollup({ groupBy: "workspace", workspaceId, from: day.from, to: day.to });
  if (!totals.ok) {
    return err({ code: "session.store_failed", message: totals.error.message });
  }
  const spent = totals.value.reduce((sum, row) => sum + row.credits, 0);
  if (spent < capCredits) {
    return ok(undefined);
  }
  return err({
    code: "session.budget_exhausted",
    message: `workspace ${workspaceId} has used ${String(spent)} of its ${String(capCredits)} daily credits; the cap resets at ${day.to}`,
    resetAt: day.to,
  });
}

export function sessionSpend(usage: Pick<UsageRepository, "rollup">, sessionId: string): number {
  const totals = usage.rollup({ groupBy: "session", sessionId });
  return totals.ok ? totals.value.reduce((sum, row) => sum + row.credits, 0) : 0;
}
