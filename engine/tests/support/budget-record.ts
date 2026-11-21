import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// One measured PLAN.md §9 budget, as the H-07 performance gate reports it (docs/performance.md).
// `id` is the row's id in tools/perf/budgets.json.
export interface BudgetMeasurement {
  readonly id: string;
  readonly measured: number;
  readonly threshold: number;
  readonly unit: string;
  readonly samples?: readonly number[];
}

// Writes the measurement to `$PICA_PERF_DIR/<id>.json` when the gate asks for it (`make perf`);
// otherwise does nothing. The test still asserts the threshold itself.
export function recordBudget(measurement: BudgetMeasurement, env: Readonly<Record<string, string | undefined>> = process.env): void {
  const directory = env["PICA_PERF_DIR"];
  if (directory === undefined || directory === "") return;
  mkdirSync(directory, { recursive: true });
  const rounded = { ...measurement, measured: round(measurement.measured), samples: measurement.samples?.map(round) };
  writeFileSync(join(directory, `${measurement.id}.json`), `${JSON.stringify(rounded)}\n`);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// True when the H-07 gate runs (`make perf`, PICA_PERF_GATE=1): budgets are asserted as PLAN.md §9
// states them, even on CI.
export function perfGate(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env["PICA_PERF_GATE"] === "1";
}
