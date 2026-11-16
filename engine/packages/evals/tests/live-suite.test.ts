import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { evalSuite, reasoningInput, renderMarkdown, runSuite } from "../src/index.ts";
import type { RoutingProfile } from "../src/index.ts";

// C-10 (live; PICA_LIVE=1 and a Copilot CLI login): the suite under `off` and `balanced` against
// Copilot, through the production composition. Each task gets its own Pica data directory under a
// scratch directory, so the signed-in user's Pica data is untouched; it does spend Copilot quota.
// The report is written to docs/evals/ for committing. EVAL_TASKS=id,id runs a subset, EVAL_PROFILES=a,b
// other profiles, and EVAL_RUNS=n sets the runs per task (3 by default).
const live = process.env["PICA_LIVE"] === "1";
const docsDir = join(import.meta.dirname, "..", "..", "..", "..", "docs", "evals");
const workRoot = realpathSync(mkdtempSync(join(tmpdir(), "pica-ev-")));

// EVAL_KEEP=1 keeps each task's data directory and working copy, for looking into a run.
afterAll(() => {
  if (process.env["EVAL_KEEP"] === "1") console.log(`kept ${workRoot}`);
  else rmSync(workRoot, { recursive: true, force: true });
});

describe.skipIf(!live)("C-10 live: balanced against off", () => {
  it("balanced uses at least 60% fewer reasoning-tier input tokens, with at most one fewer task succeeding", { timeout: 4 * 60 * 60_000 }, async () => {
    const only = process.env["EVAL_TASKS"]?.split(",");
    const report = await runSuite({
      tasks: only === undefined ? evalSuite : evalSuite.filter((task) => only.includes(task.id)),
      profiles: process.env["EVAL_PROFILES"] === undefined ? ["off", "balanced"] : (process.env["EVAL_PROFILES"].split(",") as RoutingProfile[]),
      backend: { name: "copilot", runtime: () => undefined },
      workRoot,
      now: () => Date.now(),
      sessionCredits: 100,
      runs: Number(process.env["EVAL_RUNS"] ?? "3"),
      onRunDone: (profile, task, run, measurement) => {
        console.log(`${profile} ${task.id} run ${String(run)}: ${measurement.succeeded ? "pass" : "FAIL"}, ${String(reasoningInput(measurement))} reasoning input, ${measurement.detail}`);
      },
    });
    mkdirSync(docsDir, { recursive: true });
    const stem = join(docsDir, `${report.generatedAt.slice(0, 10)}-c10-live`);
    writeFileSync(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(`${stem}.md`, renderMarkdown(report));
    console.log(renderMarkdown(report));
    expect(report.comparison?.meetsTarget).toBe(true);
  });
});
