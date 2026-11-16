import { reasoningInput } from "./report.ts";
import type { Comparison, EvalReport, ProfileResult } from "./report.ts";

function count(value: number): string {
  return value.toLocaleString("en-US");
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function summary(profiles: readonly ProfileResult[]): string {
  return table(
    ["Profile", "Reasoning model", "Worker model", "Succeeded", "Reasoning input (fresh + cached)", "Reasoning output", "Worker input", "Credits", "Wall time"],
    profiles.map(({ profile, tiers, totals }) => [
      profile,
      tiers.reasoning.join(", ") || "none",
      tiers.worker.join(", ") || "none",
      `${String(totals.succeeded)}/${String(totals.tasks)}`,
      `${count(reasoningInput(totals))} (${count(totals.reasoningInputTokens)} + ${count(totals.reasoningCachedInputTokens)})`,
      count(totals.reasoningOutputTokens),
      count(totals.workerInputTokens + totals.workerCachedInputTokens),
      totals.credits.toFixed(4),
      seconds(totals.wallTimeMs),
    ]),
  );
}

function comparison(result: Comparison): string {
  const reduction = result.reasoningInputReduction === null ? "n/a (no baseline input)" : `${percent(result.reasoningInputReduction)} fewer`;
  const lines = [
    `## ${result.candidate} against ${result.baseline}`,
    "",
    `- Reasoning-tier input tokens: ${count(result.candidateReasoningInput)} against ${count(result.baselineReasoningInput)}, ${reduction} (target: at least ${percent(result.target.minReduction)} fewer).`,
    `- Tasks succeeded: ${result.successDelta >= 0 ? "+" : ""}${String(result.successDelta)} (target: at most ${String(result.target.maxSuccessDrop)} fewer).`,
    `- Target met: ${result.meetsTarget ? "yes" : "no"}.`,
  ];
  if (!result.tiersDistinct) {
    lines.push("- No worker-tier call ran on a model of its own, so delegation moves tokens between agents but cannot lower credits.");
  }
  return lines.join("\n");
}

function tasks(profiles: readonly ProfileResult[]): string {
  const ids = profiles[0]?.tasks.map((task) => task.taskId) ?? [];
  const rows = ids.map((id) => {
    const cells = profiles.map((result) => {
      const task = result.tasks.find((entry) => entry.taskId === id);
      if (task === undefined) return "—";
      return `${task.succeeded ? "pass" : "FAIL"}, ${count(reasoningInput(task))} in, ${String(task.costDecisions)} gated`;
    });
    const category = profiles[0]?.tasks.find((task) => task.taskId === id)?.category ?? "";
    return [id, category, ...cells];
  });
  return table(["Task", "Category", ...profiles.map((result) => result.profile)], rows);
}

function failures(profiles: readonly ProfileResult[]): string {
  const lines = profiles.flatMap((result) =>
    result.tasks.filter((task) => !task.succeeded).map((task) => `- ${result.profile} / ${task.taskId}: ${task.detail}`),
  );
  return lines.length === 0 ? "None." : lines.join("\n");
}

// The human-readable form of the report; the JSON form is the record.
export function renderMarkdown(report: EvalReport): string {
  const sections = [
    "# Pica eval report (C-10)",
    "",
    `Runtime: ${report.runtime}. Generated ${report.generatedAt}. "Reasoning input" counts fresh and cached input tokens of reasoning-tier calls; "gated" counts cost-rule decisions that were not allow.`,
    "",
    "## Summary",
    "",
    summary(report.profiles),
    "",
  ];
  if (report.comparison !== null) {
    sections.push(comparison(report.comparison), "");
  }
  sections.push("## Tasks", "", tasks(report.profiles), "", "## Failures", "", failures(report.profiles), "");
  return sections.join("\n");
}
