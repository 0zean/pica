// The H-07 performance gate's report (docs/performance.md): each budget in tools/perf/budgets.json
// against the measurement its test recorded. A budget passes only when it was measured, its test
// asserted the registry's threshold (so a test cannot loosen it unseen), and the value is under it.

export interface Budget {
  readonly id: string;
  readonly metric: string;
  readonly budget: string;
  readonly owner: string;
  readonly threshold: number;
  readonly unit: string;
  readonly statistic: string;
  readonly test: string;
  // Not a PLAN.md §9 row: a unit's own timing check the gate also reports.
  readonly extra?: boolean;
}

export interface Measurement {
  readonly id: string;
  readonly measured: number;
  readonly threshold: number;
  readonly unit: string;
  readonly samples?: readonly number[];
}

export type Status = "pass" | "over" | "missing" | "threshold-mismatch";

export interface Row {
  readonly budget: Budget;
  readonly measurement: Measurement | undefined;
  readonly status: Status;
}

export function evaluate(budgets: readonly Budget[], measurements: readonly Measurement[]): readonly Row[] {
  const byId = new Map(measurements.map((measurement) => [measurement.id, measurement]));
  return budgets.map((budget) => {
    const measurement = byId.get(budget.id);
    return { budget, measurement, status: status(budget, measurement) };
  });
}

function status(budget: Budget, measurement: Measurement | undefined): Status {
  if (measurement === undefined) return "missing";
  if (measurement.threshold !== budget.threshold || measurement.unit !== budget.unit) return "threshold-mismatch";
  return measurement.measured < budget.threshold ? "pass" : "over";
}

export function passed(rows: readonly Row[]): boolean {
  return rows.every((row) => row.status === "pass");
}

const statusText: Record<Status, string> = {
  pass: "pass",
  over: "**over budget**",
  missing: "**not measured**",
  "threshold-mismatch": "**test asserts a different threshold**",
};

export function markdown(rows: readonly Row[], heading: string): string {
  const lines = [
    `### ${heading}`,
    "",
    "| Budget | Owner | Test | Statistic | Threshold | Measured | Samples | Result |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const { budget, measurement, status: result } of rows) {
    const name = budget.extra === true ? `${budget.metric} (not §9)` : budget.metric;
    const measured = measurement === undefined ? "—" : `${format(measurement.measured)} ${measurement.unit}`;
    const samples = measurement?.samples?.map(format).join(", ") ?? "";
    lines.push(
      `| ${name} ${budget.budget} | ${budget.owner} | \`${budget.test}\` | ${budget.statistic} | ` +
        `< ${format(budget.threshold)} ${budget.unit} | ${measured} | ${samples} | ${statusText[result]} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function format(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 1 ? value.toFixed(2) : value.toFixed(3);
}

// PLAN.md §9's rows as `| Metric | Budget | Owner |`.
export function planRows(plan: string): readonly { metric: string; budget: string; owner: string }[] {
  const start = plan.indexOf("## 9. Performance budgets");
  const end = plan.indexOf("\n## ", start + 1);
  const section = plan.slice(start, end);
  return section
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Metric") && !line.startsWith("|---"))
    .map((line) => {
      const [metric = "", budget = "", owner = ""] = line.slice(2, -2).split(" | ");
      return { metric, budget, owner };
    });
}

// Measurements from an `xcresulttool export attachments` folder: attachments named `budget-<id>.json`.
export interface ExportedTest {
  readonly attachments: readonly { readonly exportedFileName: string; readonly suggestedHumanReadableName: string }[];
}

export function budgetAttachments(manifest: readonly ExportedTest[]): readonly string[] {
  return manifest.flatMap((test) =>
    test.attachments
      .filter((attachment) => attachment.suggestedHumanReadableName.startsWith("budget-"))
      .map((attachment) => attachment.exportedFileName),
  );
}
