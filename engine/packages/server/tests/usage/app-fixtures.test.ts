import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Store, TokenPrices, UsageRecord } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { silentLogger, startEngine } from "../../src/index.ts";
import type { SocketListener } from "../../src/index.ts";
import { TestClient } from "../helpers.ts";
import { call, openSeededStore, workspaceId } from "../sessions/helpers.ts";

// Where the app's usage view-model and snapshot tests read the ledger's rollups from (A-11, docs/usage.md);
// `PICA_UPDATE_FIXTURES=1` rewrites the file.
const appFixture = join(import.meta.dirname, "../../../../../app/Packages/Usage/Tests/UsageTests/Fixtures/ledger-rollups.json");

const reasoning: TokenPrices = { input: 300, cachedInput: 30, output: 1500 };
const prices: Readonly<Record<string, TokenPrices>> = {
  "claude-sonnet": reasoning,
  "gpt-mini": { input: 25, cachedInput: 2.5, output: 125 },
  "gemini-flash": { input: 40, cachedInput: 4, output: 160 },
};

// Three workspaces (ws-1 from the seeded store), five sessions, four agents, three models over nine UTC days;
// 2026-11-12 and 2026-11-14 have no usage. The app's "Last 7 Days" ending 2026-11-16 starts on 2026-11-10, so the
// record on 2026-11-08 falls outside it.
const workspaces = [
  { id: "ws-2", name: "Search" },
  { id: "ws-3", name: "Mobile" },
];
const sessions: Readonly<Record<string, string>> = {
  "s-1": "ws-1",
  "s-2": "ws-1",
  "s-3": "ws-2",
  "s-4": "ws-2",
  "s-5": "ws-3",
};

type Tokens = readonly [input: number, cached: number, output: number];

const calls: readonly (readonly [session: string, agent: string, model: string, tokens: Tokens, timestamp: string])[] = [
  ["s-5", "main", "claude-sonnet", [9000, 2000, 700], "2026-11-08T15:00:00.000Z"],
  ["s-1", "main", "claude-sonnet", [12000, 30000, 900], "2026-11-10T09:00:00.000Z"],
  ["s-1", "bulk-reader", "gpt-mini", [180000, 0, 1500], "2026-11-10T09:02:00.000Z"],
  ["s-1", "main", "claude-sonnet", [4000, 42000, 600], "2026-11-10T09:05:00.000Z"],
  ["s-2", "main", "claude-sonnet", [8000, 10000, 1200], "2026-11-11T14:00:00.000Z"],
  ["s-2", "code-writer", "gpt-mini", [40000, 12000, 6000], "2026-11-11T14:03:00.000Z"],
  ["s-3", "main", "gemini-flash", [20000, 5000, 800], "2026-11-13T08:30:00.000Z"],
  ["s-3", "repo-scout", "gpt-mini", [60000, 0, 900], "2026-11-13T08:31:00.000Z"],
  ["s-4", "main", "claude-sonnet", [15000, 60000, 2000], "2026-11-15T22:00:00.000Z"],
  ["s-4", "bulk-reader", "gemini-flash", [250000, 20000, 2500], "2026-11-15T22:04:00.000Z"],
  ["s-2", "main", "claude-sonnet", [30000, 80000, 4000], "2026-11-16T10:00:00.000Z"],
  ["s-2", "code-writer", "gpt-mini", [90000, 20000, 12000], "2026-11-16T10:10:00.000Z"],
  ["s-5", "main", "claude-sonnet", [5000, 9000, 300], "2026-11-16T11:00:00.000Z"],
];

function credits(model: string, [input, cached, output]: Tokens): number {
  const price = prices[model];
  if (price === undefined) throw new Error(`no price for ${model}`);
  return Math.round((input * price.input + cached * price.cachedInput + output * price.output) / 1e2) / 1e4;
}

function record([sessionId, agent, model, tokens, timestamp]: (typeof calls)[number]): UsageRecord {
  const [inputTokens, cachedTokens, outputTokens] = tokens;
  const tier: UsageRecord["tier"] = agent === "main" ? "reasoning" : "worker";
  return { sessionId, agent, model, inputTokens, cachedTokens, outputTokens, credits: credits(model, tokens), tier, timestamp };
}

// The queries the app makes: the dashboard over Last 7 Days ending 2026-11-16 (all workspaces, and ws-1 alone),
// today's spend by workspace for the daily-cap warnings, and one session's breakdown for the chip.
const week = { from: "2026-11-10T00:00:00.000Z", to: "2026-11-17T00:00:00.000Z" };
const today = { from: "2026-11-16T00:00:00.000Z", to: "2026-11-17T00:00:00.000Z" };
const queries: Readonly<Record<string, Record<string, unknown>>> = {
  "week.day": { groupBy: "day", ...week },
  "week.model": { groupBy: "model", ...week },
  "week.agent": { groupBy: "agent", ...week },
  "week.workspace": { groupBy: "workspace", ...week },
  "week.ws-1.day": { groupBy: "day", ...week, workspaceId: "ws-1" },
  "week.ws-1.model": { groupBy: "model", ...week, workspaceId: "ws-1" },
  "week.ws-1.agent": { groupBy: "agent", ...week, workspaceId: "ws-1" },
  "today.workspace": { groupBy: "workspace", ...today },
  "session.s-2.agent": { groupBy: "agent", sessionId: "s-2" },
  "session.s-2.model": { groupBy: "model", sessionId: "s-2" },
};

interface Running {
  readonly engine: SocketListener;
  readonly store: Store;
  readonly client: TestClient;
  readonly dir: string;
}

let running: Running | undefined;

afterEach(async () => {
  if (running !== undefined) {
    running.client.close();
    await running.engine.close();
    running.store.close();
    await rm(running.dir, { recursive: true, force: true });
    running = undefined;
  }
});

function seed(store: Store): void {
  const must = (result: { ok: boolean; error?: { message: string } }): void => {
    if (!result.ok) throw new Error(result.error?.message);
  };
  for (const workspace of workspaces) {
    must(store.workspaces.save({ ...workspace, sources: [], pinnedRepoIds: [], settingsOverrides: {} }));
  }
  for (const [id, workspace] of Object.entries(sessions)) {
    must(
      store.sessions.create({
        id,
        workspaceId: workspace,
        writeRoots: [],
        referenceRoots: [],
        state: "ended",
        routingProfile: "balanced",
        budgetMaxCredits: null,
        createdAt: "2026-11-08T00:00:00.000Z",
        updatedAt: "2026-11-08T00:00:00.000Z",
      }),
    );
  }
  for (const entry of calls) {
    must(store.usage.record(record(entry)));
  }
}

async function start(): Promise<Running> {
  const dir = await mkdtemp(join(tmpdir(), "picad-usage-fixtures-"));
  const store = openSeededStore(join(dir, "pica.db"));
  seed(store);
  const socketPath = join(dir, "run", "picad.sock");
  const ids = sequentialIds();
  const engine = await startEngine({
    socketPath,
    log: silentLogger,
    sessions: {
      store,
      runtime: new FakeRuntime({
        scenario: scenarioSchema.parse({ version: 1, models: [{ id: "claude-sonnet", name: "Sonnet" }], defaultModel: "claude-sonnet", turns: [] }),
      }),
      clock: steppingClock("2026-11-16T12:00:00.000Z"),
      newSessionId: () => ids("session"),
      usage: { pricesFor: (model) => prices[model] ?? null, reasoningPrices: () => reasoning },
    },
  });
  running = { engine, store, client: await TestClient.connectAndHello(socketPath), dir };
  return running;
}

describe("the app's usage fixtures", () => {
  it("are what the engine answers for the fixture ledger", async () => {
    const { client } = await start();
    const rollups: Record<string, unknown> = {};
    for (const [name, params] of Object.entries(queries)) {
      rollups[name] = await call(client, "usage.rollup", params);
    }
    // `workspace.list` needs the workspace service, which this engine is not given; the app asks it for these names.
    const fixture = { now: "2026-11-16T12:00:00.000Z", workspaces: [{ id: workspaceId, name: "Payments" }, ...workspaces], rollups };

    const byWorkspace = rollups["week.workspace"] as { rows: { key: string }[]; savings: { credits: number } };
    expect(byWorkspace.rows.map((row) => row.key)).toEqual([workspaceId, "ws-2", "ws-3"]);
    expect(byWorkspace.savings.credits).toBeGreaterThan(0);
    expect((rollups["week.day"] as { rows: { key: string }[] }).rows.map((row) => row.key)).toEqual([
      "2026-11-10",
      "2026-11-11",
      "2026-11-13",
      "2026-11-15",
      "2026-11-16",
    ]);

    const text = `${JSON.stringify(fixture, null, 2)}\n`;
    if (process.env["PICA_UPDATE_FIXTURES"] === "1") writeFileSync(appFixture, text);
    // The app's view-model and snapshot tests draw these answers, so they must be what the engine sends.
    expect(readFileSync(appFixture, "utf8")).toBe(text);
  });
});
