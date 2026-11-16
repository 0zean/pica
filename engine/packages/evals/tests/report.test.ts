import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedPolicyLoader } from "@pica/adapters";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { evalSuite, renderMarkdown, runSuite } from "../src/index.ts";
import type { EvalBackend, EvalTask, TaskRun } from "../src/index.ts";

// C-10: against FakeRuntime the harness produces exactly the expected report. Each task's session
// plays a scripted turn through the production composition (E-11): under `off` the main agent does
// the work itself; under `balanced` it reads the large file once (the read gate denies it), then
// delegates to a worker. Each task runs three times, with the main agent's input growing by run, so
// the report shows means and spreads. The reference solution stands in for the edits a model would
// make, and one task is left unsolved in one `balanced` run to show a failure in the report.
// Regenerate the golden files with UPDATE_GOLDEN=1 after an intended change.

const goldenDir = join(import.meta.dirname, "golden");
const unsolved = { profile: "balanced", taskId: "prettier-config", run: 2 } as const;
const largeFiles: Readonly<Record<string, string>> = {
  "schema-column-owner": "db/schema.sql",
  "settlement-log-error": "logs/settlement.log",
  "error-code-value": "src/generated/error-codes.mjs",
};

const models = [
  { id: "model-r", name: "Reasoning", tokenPrices: { input: 300, cachedInput: 30, output: 1500 } },
  { id: "model-w", name: "Worker", tokenPrices: { input: 25, cachedInput: 2.5, output: 125 } },
];

function steps(task: EvalTask, index: number, run: TaskRun): unknown[] {
  const { profile, workdir } = run;
  const extra = (run.run - 1) * 500;
  const largeFile = largeFiles[task.id];
  const read = largeFile === undefined ? [] : [{ type: "toolCall", name: "view", arguments: { path: join(workdir, largeFile) }, result: "file contents" }];
  if (profile === "off") {
    return [...read, { type: "usage", model: "model-r", inputTokens: 18000 + index * 1000 + extra, cachedInputTokens: 6000, outputTokens: 400 }];
  }
  const agentName = task.category === "large-file-question" || task.category === "comprehension" ? "bulk-reader" : "code-writer";
  return [
    ...read,
    { type: "usage", model: "model-r", inputTokens: 2500 + index * 100 + extra, cachedInputTokens: 2000, outputTokens: 150 },
    {
      type: "subagent",
      agentName,
      model: "model-w",
      steps: [{ type: "usage", model: "model-w", inputTokens: 16000 + index * 1000, cachedInputTokens: 1000, outputTokens: 500 }],
    },
  ];
}

const fakeBackend: EvalBackend = {
  name: "fake",
  runtime: (run: TaskRun) => {
    const index = evalSuite.indexOf(run.task);
    const solved = !(run.profile === unsolved.profile && run.task.id === unsolved.taskId && run.run === unsolved.run);
    const answer = solved ? run.task.solve(run.workdir) : "I could not finish.";
    const scenario = scenarioSchema.parse({
      version: 1,
      models,
      defaultModel: "model-r",
      turns: [{ steps: [...steps(run.task, index, run), { type: "text", content: answer }] }],
    });
    return new FakeRuntime({ scenario, clock: steppingClock("2026-11-16T09:00:00.000Z"), ids: sequentialIds() });
  },
};

function steppingNow(): () => number {
  let at = Date.parse("2026-11-16T09:00:00.000Z");
  return () => (at += 1500);
}

let workRoot: string | undefined;

afterEach(() => {
  if (workRoot !== undefined) rmSync(workRoot, { recursive: true, force: true });
  workRoot = undefined;
});

function matchGolden(name: string, actual: string): void {
  const file = join(goldenDir, name);
  if (process.env["UPDATE_GOLDEN"] === "1") writeFileSync(file, actual);
  expect(actual).toBe(readFileSync(file, "utf8"));
}

describe("C-10 eval harness against FakeRuntime", () => {
  it("produces exactly the expected JSON and Markdown reports", { timeout: 60_000 }, async () => {
    workRoot = realpathSync(mkdtempSync(join(tmpdir(), "pica-ev-")));
    const report = await runSuite({
      tasks: evalSuite,
      profiles: ["off", "balanced"],
      backend: fakeBackend,
      runs: 3,
      workRoot,
      now: steppingNow(),
      managedPolicy: new ManagedPolicyLoader([]),
    });
    matchGolden("report.json", `${JSON.stringify(report, null, 2)}\n`);
    matchGolden("report.md", renderMarkdown(report));
  });
});
