// Prints the H-07 performance gate's report and exits 1 unless every budget passed.
// Usage: perf-report <budgets.json> <measurements folder> [<xcresult attachments folder>...]
// The measurements folder holds `<id>.json` files the engine and Swift package tests wrote
// (PICA_PERF_DIR); each attachments folder is `xcresulttool export attachments` of a UI-test result.
// PERF_NOT_GATING names budget ids reported without failing the gate (docs/performance.md).
// The report also goes to `<measurements folder>/report.md` and, on GitHub Actions, the job summary.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { budgetAttachments, evaluate, markdown, passed } from "./report.ts";
import type { Budget, ExportedTest, Measurement } from "./report.ts";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(): void {
  const [budgetsPath, measurementsDir, ...exports] = process.argv.slice(2);
  if (budgetsPath === undefined || measurementsDir === undefined) {
    console.error("usage: perf-report <budgets.json> <measurements folder> [<xcresult attachments folder>...]");
    process.exit(2);
  }
  mkdirSync(measurementsDir, { recursive: true });
  const measurements: Measurement[] = [];
  for (const name of readdirSync(measurementsDir).filter((file) => file.endsWith(".json"))) {
    measurements.push(readJson(join(measurementsDir, name)) as Measurement);
  }
  for (const folder of exports) {
    const manifest = join(folder, "manifest.json");
    if (!existsSync(manifest)) continue;
    for (const file of budgetAttachments(readJson(manifest) as ExportedTest[])) {
      measurements.push(readJson(join(folder, file)) as Measurement);
    }
  }
  const notGating = new Set((process.env["PERF_NOT_GATING"] ?? "").split(" ").filter((id) => id !== ""));
  const rows = evaluate(readJson(budgetsPath) as Budget[], measurements, notGating);
  const report = markdown(rows, "Performance budgets (PLAN.md §9)");
  process.stdout.write(report);
  writeFileSync(join(measurementsDir, "report.md"), report);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") appendFileSync(summary, report);
  process.exit(passed(rows) ? 0 : 1);
}

main();
