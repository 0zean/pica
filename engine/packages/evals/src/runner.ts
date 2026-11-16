import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { roundCredits } from "@pica/core";
import type { AgentRuntime, Store, UsageTotals } from "@pica/core";
import type { SessionEvent } from "@pica/protocol";
import { composeEngine, picaDataDir, silentLogger, startEngine } from "@pica/server";
import type { ProductionOptions } from "@pica/server";
import { fail } from "./check-helpers.ts";
import type { CheckResult } from "./check-helpers.ts";
import { isolatedGitEnv, materializeRepo } from "./fixture-repos.ts";
import { buildReport, profileResult, taskMeasurement } from "./report.ts";
import type { EvalReport, RoutingProfile, RunMeasurement, TierModels } from "./report.ts";
import { EvalClient } from "./rpc-client.ts";
import type { EvalTask } from "./tasks/index.ts";

export interface TaskRun {
  readonly task: EvalTask;
  readonly profile: RoutingProfile;
  // 1-based, among the task's runs under this profile.
  readonly run: number;
  readonly workdir: string;
}

// What answers the model calls. The live backend is Copilot; tests play scripted scenarios.
export interface EvalBackend {
  readonly name: string;
  // The runtime for one task's engine, built once its working copy exists; undefined composes the
  // Copilot runtime, as `picad` does.
  runtime(run: TaskRun): AgentRuntime | undefined;
}

export interface RunSuiteOptions {
  readonly tasks: readonly EvalTask[];
  readonly profiles: readonly RoutingProfile[];
  readonly backend: EvalBackend;
  // An empty scratch directory with a short path: each engine's socket lives in it, and macOS
  // limits a socket path to 104 bytes. The caller removes it.
  readonly workRoot: string;
  // Wall time and the report's timestamp; tests pass a stepping clock.
  readonly now: () => number;
  readonly managedPolicy?: ProductionOptions["managedPolicy"];
  readonly sessionCredits?: number;
  readonly taskTimeoutMs?: number;
  // Sessions per task and profile; the report gives their mean and spread. Defaults to 1.
  readonly runs?: number;
  readonly onRunDone?: (profile: RoutingProfile, task: EvalTask, run: number, measurement: RunMeasurement) => void;
}

const defaultTaskTimeoutMs = 15 * 60_000;

// C-10: runs every task `runs` times per profile, each run in a fresh engine with the production composition
// (E-11), a fresh copy of its fixture repo, and its own Pica data directory, then measures the
// session from the usage ledger (C-08).
export async function runSuite(options: RunSuiteOptions): Promise<EvalReport> {
  const results = [];
  let index = 0;
  for (const profile of options.profiles) {
    const measurements = [];
    const reasoning = new Set<string>();
    const worker = new Set<string>();
    for (const task of options.tasks) {
      const runs: RunMeasurement[] = [];
      for (let run = 1; run <= (options.runs ?? 1); run += 1) {
        const done = await runTask(options, { profile, task, run, index });
        index += 1;
        for (const model of done.tiers.reasoning) reasoning.add(model);
        for (const model of done.tiers.worker) worker.add(model);
        runs.push(done.measurement);
        options.onRunDone?.(profile, task, run, done.measurement);
      }
      measurements.push(taskMeasurement(task, runs));
    }
    results.push(profileResult(profile, { reasoning: [...reasoning].sort(), worker: [...worker].sort() }, measurements));
  }
  return buildReport(options.backend.name, new Date(options.now()).toISOString(), results);
}

interface TaskSlot {
  readonly profile: RoutingProfile;
  readonly task: EvalTask;
  readonly run: number;
  readonly index: number;
}

async function runTask(options: RunSuiteOptions, slot: TaskSlot): Promise<{ measurement: RunMeasurement; tiers: TierModels }> {
  const dir = join(options.workRoot, slot.profile, slot.task.id, `run-${String(slot.run)}`);
  const home = join(dir, "home");
  materializeRepo(slot.task.repo, join(dir, "repo"));
  const run: TaskRun = { task: slot.task, profile: slot.profile, run: slot.run, workdir: realpathSync(join(dir, "repo")) };
  writeUserConfig(home);
  const runtime = options.backend.runtime(run);
  const composed = composeEngine({
    homeDir: home,
    userName: "pica-evals",
    env: { ...process.env, ...isolatedGitEnv },
    log: silentLogger,
    ...(runtime === undefined ? {} : { runtime }),
    ...(options.managedPolicy === undefined ? {} : { managedPolicy: options.managedPolicy }),
  });
  const store = composed.options.sessions?.store;
  if (store === undefined) throw new Error("the composed engine has no session store");
  const listener = await startEngine({ socketPath: join(options.workRoot, `s${String(slot.index)}`), log: silentLogger, ...composed.options });
  const client = await EvalClient.open(listener.socketPath);
  try {
    return await measureSession(options, run, client, store);
  } finally {
    client.close();
    await listener.close();
    await composed.close();
  }
}

// Tool calls are allowed without asking, so a run never waits for a person; the cost gates still
// apply, since they come before the permission mode (PLAN.md §5.3).
function writeUserConfig(home: string): void {
  const dataDir = picaDataDir(home);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "config.jsonc"), `${JSON.stringify({ permissions: { mode: "auto" } }, null, 2)}\n`);
}

async function measureSession(options: RunSuiteOptions, run: TaskRun, client: EvalClient, store: Store): Promise<{ measurement: RunMeasurement; tiers: TierModels }> {
  const { workspace } = await client.call<{ workspace: { id: string } }>("workspace.create", { name: `eval ${run.task.id}` });
  const { repo } = await client.call<{ repo: { id: string } }>("repo.addPath", { path: run.workdir });
  const { session } = await client.call<{ session: { id: string } }>("session.create", {
    workspaceId: workspace.id,
    writeRepoIds: [repo.id],
    referenceRepoIds: [],
    routingProfile: run.profile,
    ...(options.sessionCredits === undefined ? {} : { budgetCredits: options.sessionCredits }),
  });
  await client.call("events.subscribe", { sessionId: session.id, afterSeq: 0 });
  const ready = await client.waitForEvent(0, isState("idle"));
  const started = options.now();
  await client.call("session.send", { sessionId: session.id, text: run.task.prompt, mode: "send" });
  const outcome = await finishTurn(client, session.id, ready + 1, options.taskTimeoutMs ?? defaultTaskTimeoutMs);
  const wallTimeMs = options.now() - started;
  const events = client.events();
  const check = runCheck(run.task, run.workdir, lastAnswer(events));
  const result: CheckResult = outcome === "idle" ? check : fail(`session ${outcome}; ${check.detail}`);
  await client.call("session.end", { sessionId: session.id });
  return {
    tiers: tierModels(store, session.id),
    measurement: {
      succeeded: outcome === "idle" && result.passed,
      detail: result.detail,
      costDecisions: events.filter(isGatedCostDecision).length,
      ...tierUsage(store, session.id),
      wallTimeMs,
    },
  };
}

function runCheck(task: EvalTask, workdir: string, answer: string): CheckResult {
  try {
    return task.check({ workdir, answer });
  } catch (error) {
    return fail(`the check threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type TurnOutcome = "idle" | "failed" | "ended" | "timed out";

// Waits for the turn to end, approving tool calls and declining budget raises along the way.
async function finishTurn(client: EvalClient, sessionId: string, from: number, timeoutMs: number): Promise<TurnOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timed out">((resolve) => {
    timer = setTimeout(() => {
      resolve("timed out");
    }, timeoutMs);
  });
  try {
    const outcome = await Promise.race([watchTurn(client, from), timedOut]);
    if (outcome === "timed out") await client.call("session.abort", { sessionId });
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}

async function watchTurn(client: EvalClient, from: number): Promise<Exclude<TurnOutcome, "timed out">> {
  let next = from;
  for (;;) {
    const index = await client.waitForEvent(next, (event) => event.type === "session.state_changed" || event.type === "approval.requested");
    const event = client.events()[index];
    next = index + 1;
    if (event?.type === "approval.requested") {
      const choice = event.payload.kind === "tool_call" ? "allow_once" : "deny";
      await client.call("approval.resolve", { approvalId: event.payload.id, choice });
    } else if (event?.type === "session.state_changed" && event.payload.to !== "running" && event.payload.to !== "awaiting_approval") {
      return event.payload.to === "idle" ? "idle" : event.payload.to === "ended" ? "ended" : "failed";
    }
  }
}

function isState(state: string): (event: SessionEvent) => boolean {
  return (event) => event.type === "session.state_changed" && event.payload.to === state;
}

function isGatedCostDecision(event: SessionEvent): boolean {
  return event.type === "policy.decision" && event.payload.ruleGroup === "cost" && event.payload.outcome !== "allow";
}

function lastAnswer(events: readonly SessionEvent[]): string {
  const messages = events.filter((event) => event.type === "assistant.message" && event.payload.agent === "main");
  const last = messages.at(-1);
  return last?.type === "assistant.message" ? last.payload.text : "";
}

// The models each tier's calls ran on, as the ledger recorded them.
function tierModels(store: Store, sessionId: string): TierModels {
  const records = store.usage.listBySession(sessionId);
  if (!records.ok) throw new Error(`usage records: ${records.error.message}`);
  const modelsOf = (tier: string): string[] => [...new Set(records.value.filter((record) => record.tier === tier).map((record) => record.model))].sort();
  return { reasoning: modelsOf("reasoning"), worker: modelsOf("worker") };
}

const noUsage: UsageTotals = { key: "", calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, credits: 0 };

function tierUsage(store: Store, sessionId: string): Omit<RunMeasurement, "succeeded" | "detail" | "costDecisions" | "wallTimeMs"> {
  const rows = store.usage.rollup({ groupBy: "tier", sessionId });
  if (!rows.ok) throw new Error(`usage rollup: ${rows.error.message}`);
  const reasoning = rows.value.find((row) => row.key === "reasoning") ?? noUsage;
  const worker = rows.value.find((row) => row.key === "worker") ?? noUsage;
  return {
    reasoningInputTokens: reasoning.inputTokens,
    reasoningCachedInputTokens: reasoning.cachedTokens,
    reasoningOutputTokens: reasoning.outputTokens,
    workerInputTokens: worker.inputTokens,
    workerCachedInputTokens: worker.cachedTokens,
    workerOutputTokens: worker.outputTokens,
    credits: roundCredits(rows.value.reduce((sum, row) => sum + row.credits, 0)),
  };
}
