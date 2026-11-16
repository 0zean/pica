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

// One session of one task.
export interface RunMeasurement extends TokenTotals {
  readonly succeeded: boolean;
  readonly detail: string;
  // Cost-rule policy decisions that were not `allow`: redirected reads, denied shell writes,
  // truncated outputs.
  readonly costDecisions: number;
}

export interface Spread {
  readonly min: number;
  readonly max: number;
}

// A task over all its runs: the token, credit and time fields are means (tokens and milliseconds
// rounded to whole numbers), and the spreads are per-run minimum and maximum.
export interface TaskMeasurement extends TokenTotals {
  readonly taskId: string;
  readonly category: TaskCategory;
  readonly successes: number;
  readonly runCount: number;
  readonly costDecisions: number;
  readonly reasoningInputSpread: Spread;
  readonly creditsSpread: Spread;
  readonly runs: readonly RunMeasurement[];
}

// The models each tier's calls ran on, from the ledger.
export interface TierModels {
  readonly reasoning: readonly string[];
  readonly worker: readonly string[];
}

export interface ProfileResult {
  readonly profile: RoutingProfile;
  readonly tiers: TierModels;
  // Sums of the per-task means; `succeeded` is the mean number of tasks that succeeded per run.
  readonly totals: TokenTotals & { readonly tasks: number; readonly succeeded: number };
  readonly tasks: readonly TaskMeasurement[];
}

// PLAN.md C-10: `balanced` uses at least 60% fewer reasoning-tier input tokens than `off`, with at
// most one fewer task succeeding, both judged on means over runs. Input counts fresh and cached
// tokens: both fill the context.
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

function sumOf(rows: readonly TokenTotals[]): TokenTotals {
  return Object.fromEntries(tokenKeys.map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)])) as Record<(typeof tokenKeys)[number], number>;
}

function spread(values: readonly number[]): Spread {
  return { min: Math.min(...values), max: Math.max(...values) };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function taskMeasurement(task: { readonly id: string; readonly category: TaskCategory }, runs: readonly RunMeasurement[]): TaskMeasurement {
  const sums = sumOf(runs);
  const means = Object.fromEntries(tokenKeys.map((key) => [key, Math.round(sums[key] / runs.length)])) as Record<(typeof tokenKeys)[number], number>;
  return {
    taskId: task.id,
    category: task.category,
    successes: runs.filter((run) => run.succeeded).length,
    runCount: runs.length,
    ...means,
    credits: roundCredits(sums.credits / runs.length),
    costDecisions: round(runs.reduce((sum, run) => sum + run.costDecisions, 0) / runs.length, 2),
    reasoningInputSpread: spread(runs.map(reasoningInput)),
    creditsSpread: spread(runs.map((run) => run.credits)),
    runs,
  };
}

export function profileResult(profile: RoutingProfile, tiers: TierModels, tasks: readonly TaskMeasurement[]): ProfileResult {
  const sums = sumOf(tasks);
  const succeeded = round(tasks.reduce((sum, task) => sum + task.successes / task.runCount, 0), 2);
  return { profile, tiers, totals: { tasks: tasks.length, succeeded, ...sums, credits: roundCredits(sums.credits) }, tasks };
}

export function reasoningInput(totals: TokenTotals): number {
  return totals.reasoningInputTokens + totals.reasoningCachedInputTokens;
}

export function compareProfiles(baseline: ProfileResult, candidate: ProfileResult): Comparison {
  const baselineInput = reasoningInput(baseline.totals);
  const candidateInput = reasoningInput(candidate.totals);
  const reduction = baselineInput === 0 ? null : Math.round((1 - candidateInput / baselineInput) * 10_000) / 10_000;
  const successDelta = round(candidate.totals.succeeded - baseline.totals.succeeded, 2);
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
