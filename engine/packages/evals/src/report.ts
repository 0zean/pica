import { roundCredits } from "@pica/core";
import type { TaskCategory } from "./tasks/index.ts";

export type RoutingProfile = "off" | "balanced" | "strict";

export interface TokenTotals {
  readonly reasoningInputTokens: number;
  readonly reasoningCachedInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly workerInputTokens: number;
  readonly workerCachedInputTokens: number;
  readonly workerOutputTokens: number;
  readonly credits: number;
  readonly wallTimeMs: number;
}

export interface TaskMeasurement extends TokenTotals {
  readonly taskId: string;
  readonly category: TaskCategory;
  readonly succeeded: boolean;
  readonly detail: string;
  // Cost-rule policy decisions that were not `allow`: redirected reads, truncated outputs.
  readonly costDecisions: number;
}

// The models each tier's calls ran on, from the ledger.
export interface TierModels {
  readonly reasoning: readonly string[];
  readonly worker: readonly string[];
}

export interface ProfileResult {
  readonly profile: RoutingProfile;
  readonly tiers: TierModels;
  readonly totals: TokenTotals & { readonly tasks: number; readonly succeeded: number };
  readonly tasks: readonly TaskMeasurement[];
}

// PLAN.md C-10: `balanced` uses at least 60% fewer reasoning-tier input tokens than `off`, with at
// most one fewer task succeeding. Input counts fresh and cached tokens: both fill the context.
export const savingsTarget = { minReduction: 0.6, maxSuccessDrop: 1 } as const;

export interface Comparison {
  readonly baseline: RoutingProfile;
  readonly candidate: RoutingProfile;
  readonly baselineReasoningInput: number;
  readonly candidateReasoningInput: number;
  // 1 − candidate / baseline, to four places; null when the baseline used no reasoning input.
  readonly reasoningInputReduction: number | null;
  readonly successDelta: number;
  // False when no worker-tier call ran on a model of its own: as on a default-model-only plan (D-16),
  // tokens then move between agents but not between models, so credits cannot show a saving.
  readonly tiersDistinct: boolean;
  readonly target: typeof savingsTarget;
  readonly meetsTarget: boolean;
}

export interface EvalReport {
  readonly suite: "C-10";
  readonly version: 1;
  readonly runtime: string;
  readonly generatedAt: string;
  readonly profiles: readonly ProfileResult[];
  readonly comparison: Comparison | null;
}

const tokenKeys = [
  "reasoningInputTokens",
  "reasoningCachedInputTokens",
  "reasoningOutputTokens",
  "workerInputTokens",
  "workerCachedInputTokens",
  "workerOutputTokens",
  "credits",
  "wallTimeMs",
] as const satisfies readonly (keyof TokenTotals)[];

export function profileResult(profile: RoutingProfile, tiers: TierModels, tasks: readonly TaskMeasurement[]): ProfileResult {
  const sums = Object.fromEntries(tokenKeys.map((key) => [key, tasks.reduce((sum, task) => sum + task[key], 0)])) as Record<
    (typeof tokenKeys)[number],
    number
  >;
  return {
    profile,
    tiers,
    totals: { tasks: tasks.length, succeeded: tasks.filter((task) => task.succeeded).length, ...sums, credits: roundCredits(sums.credits) },
    tasks,
  };
}

export function reasoningInput(totals: TokenTotals): number {
  return totals.reasoningInputTokens + totals.reasoningCachedInputTokens;
}

export function compareProfiles(baseline: ProfileResult, candidate: ProfileResult): Comparison {
  const baselineInput = reasoningInput(baseline.totals);
  const candidateInput = reasoningInput(candidate.totals);
  const reduction = baselineInput === 0 ? null : Math.round((1 - candidateInput / baselineInput) * 10_000) / 10_000;
  const successDelta = candidate.totals.succeeded - baseline.totals.succeeded;
  const tiers = candidate.tiers;
  return {
    baseline: baseline.profile,
    candidate: candidate.profile,
    baselineReasoningInput: baselineInput,
    candidateReasoningInput: candidateInput,
    reasoningInputReduction: reduction,
    successDelta,
    tiersDistinct: tiers.worker.length > 0 && tiers.worker.every((model) => !tiers.reasoning.includes(model)),
    target: savingsTarget,
    meetsTarget: reduction !== null && reduction >= savingsTarget.minReduction && successDelta >= -savingsTarget.maxSuccessDrop,
  };
}

export function buildReport(runtime: string, generatedAt: string, profiles: readonly ProfileResult[]): EvalReport {
  const baseline = profiles.find((result) => result.profile === "off");
  const candidate = profiles.find((result) => result.profile === "balanced");
  return {
    suite: "C-10",
    version: 1,
    runtime,
    generatedAt,
    profiles,
    comparison: baseline !== undefined && candidate !== undefined ? compareProfiles(baseline, candidate) : null,
  };
}
