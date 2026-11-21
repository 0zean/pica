import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { budgetAttachments, evaluate, markdown, passed, planRows } from "./report.ts";
import type { Budget } from "./report.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const budgets = JSON.parse(readFileSync(join(repoRoot, "tools", "perf", "budgets.json"), "utf8")) as Budget[];

const launch: Budget = {
  id: "launch",
  metric: "App cold launch",
  budget: "< 1.0 s",
  owner: "A-01",
  threshold: 1000,
  unit: "ms",
  statistic: "median",
  test: "LaunchPerformanceTests",
};

describe("tools/perf/budgets.json", () => {
  it("has exactly one budget for every PLAN.md §9 row, with the row's words", () => {
    const plan = readFileSync(join(repoRoot, "PLAN.md"), "utf8");
    const rows = planRows(plan);
    expect(rows.length).toBe(11);
    const registered = budgets.filter((budget) => budget.extra !== true);
    expect(registered.map(({ metric, budget, owner }) => ({ metric, budget, owner }))).toEqual(rows);
  });

  it("gives every budget a distinct id and a test that exists", () => {
    expect(new Set(budgets.map((budget) => budget.id)).size).toBe(budgets.length);
    for (const budget of budgets) {
      const file = budget.test.split(":")[0] ?? "";
      expect(() => readFileSync(join(repoRoot, file)), budget.id).not.toThrow();
    }
  });
});

describe("the gate's report", () => {
  it("passes a measurement under its threshold", () => {
    const rows = evaluate([launch], [{ id: "launch", measured: 430, threshold: 1000, unit: "ms" }]);
    expect(rows.map((row) => row.status)).toEqual(["pass"]);
    expect(passed(rows)).toBe(true);
  });

  it("fails one at or over its threshold, one not measured, and one whose test asserts another threshold", () => {
    const other = { ...launch, id: "other" };
    const third = { ...launch, id: "third" };
    const rows = evaluate(
      [launch, other, third],
      [
        { id: "launch", measured: 1000, threshold: 1000, unit: "ms" },
        { id: "third", measured: 20, threshold: 3000, unit: "ms" },
      ],
    );
    expect(rows.map((row) => row.status)).toEqual(["over", "missing", "threshold-mismatch"]);
    expect(passed(rows)).toBe(false);
  });

  it("reports a budget PERF_NOT_GATING names without failing the gate, but only when it misses", () => {
    const other = { ...launch, id: "other" };
    const rows = evaluate(
      [launch, other],
      [
        { id: "launch", measured: 1200, threshold: 1000, unit: "ms" },
        { id: "other", measured: 20, threshold: 1000, unit: "ms" },
      ],
      new Set(["launch", "other"]),
    );
    expect(rows.map((row) => row.status)).toEqual(["not-gating", "pass"]);
    expect(passed(rows)).toBe(true);
    expect(markdown(rows, "Budgets")).toContain("not gating on this runner");
  });

  it("still fails a not-gating budget whose test asserts another threshold", () => {
    const rows = evaluate([launch], [{ id: "launch", measured: 1, threshold: 3000, unit: "ms" }], new Set(["launch"]));
    expect(rows.map((row) => row.status)).toEqual(["threshold-mismatch"]);
  });

  it("writes a table row per budget with the measured value and samples", () => {
    const rows = evaluate([launch], [{ id: "launch", measured: 432.5, threshold: 1000, unit: "ms", samples: [401, 432.5] }]);
    const table = markdown(rows, "Budgets");
    expect(table).toContain("| App cold launch < 1.0 s | A-01 | `LaunchPerformanceTests` | median | < 1000 ms | 433 ms | 401, 433 | pass |");
  });

  it("finds the budget attachments in an xcresult export", () => {
    const manifest = [
      {
        attachments: [
          { exportedFileName: "A.json", suggestedHumanReadableName: "budget-launch_0_X.json" },
          { exportedFileName: "B.txt", suggestedHumanReadableName: "public.plain-text_0_Y.txt" },
        ],
      },
    ];
    expect(budgetAttachments(manifest)).toEqual(["A.json"]);
  });
});
