import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventLog, createReadGate, createSessionService } from "@pica/core";
import type { PolicyConfig, SessionService, Store } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { fileSize, JsoncConfigLoader, openSqliteStore } from "../../src/index.ts";

const workspaceId = "ws-1";
const repoId = "repo-1";

let dir: string;
let repo: string;
let workspaceConfig: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pica-read-gate-"));
  repo = join(dir, "repo");
  workspaceConfig = join(dir, "workspace.jsonc");
  await mkdir(repo);
  await writeFile(join(repo, "schema.sql"), "-- one line of SQL schema\n".repeat(8000));
  await writeFile(join(repo, "small.ts"), "x".repeat(10 * 1024));
  const opened = openSqliteStore(join(dir, "pica.db"));
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }
  store = opened.value;
  store.repos.save({ id: repoId, remoteUrl: "github.com/acme/api", localPath: repo, managed: false, defaultBranch: "main", cloneState: "ready" });
  store.workspaces.save({ id: workspaceId, name: "Payments", sources: [], pinnedRepoIds: [], settingsOverrides: {} });
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

const view = (path: string, viewRange?: [number, number]): unknown => ({
  type: "toolCall",
  name: "view",
  arguments: viewRange === undefined ? { path } : { path, view_range: viewRange },
  result: "contents",
});

function service(turns: unknown[]): SessionService {
  const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns });
  const loader = new JsoncConfigLoader([{ layer: "workspace", file: workspaceConfig }]);
  const config = (): PolicyConfig => {
    const loaded = loader.load();
    if (!loaded.ok) {
      throw new Error(loaded.error.message);
    }
    return loaded.value.config;
  };
  const ids = sequentialIds();
  return createSessionService({
    store,
    events: createEventLog(store.events),
    runtime: new FakeRuntime({ scenario }),
    clock: steppingClock("2026-11-14T09:00:00.000Z"),
    newSessionId: () => ids("session"),
    hooks: createReadGate({ sessions: store.sessions, config, fileSize }),
  });
}

interface ToolOutcome {
  readonly type: string;
  readonly agent: unknown;
  readonly error?: unknown;
}

async function runTurn(sessions: SessionService, sessionId: string, text: string): Promise<void> {
  const sent = await sessions.send(sessionId, text, "send");
  expect(sent).toEqual({ ok: true, value: { accepted: true } });
  await vi.waitFor(() => {
    expect(store.sessions.get(sessionId)).toMatchObject({ ok: true, value: { state: "idle" } });
  });
}

function toolOutcomes(sessionId: string): ToolOutcome[] {
  const events = store.events.readAfter(sessionId, 0);
  if (!events.ok) {
    throw new Error(events.error.message);
  }
  return events.value
    .filter((event) => event.type === "tool.completed" || event.type === "tool.failed")
    .map((event) => {
      const payload = event.payload as { readonly agent: unknown; readonly error?: unknown };
      return { type: event.type, agent: payload.agent, ...(payload.error === undefined ? {} : { error: payload.error }) };
    });
}

async function startSession(sessions: SessionService): Promise<string> {
  const created = await sessions.create({ workspaceId, writeRepoIds: [repoId], referenceRepoIds: [], routingProfile: "balanced" });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  return created.value.id;
}

describe("read delegation gate (FakeRuntime)", () => {
  it("denies a main-agent read of a 200 KB file with a reason naming bulk-reader", async () => {
    const sessions = service([{ steps: [view("schema.sql")] }]);
    const sessionId = await startSession(sessions);
    await runTurn(sessions, sessionId, "read the schema");

    const [outcome] = toolOutcomes(sessionId);
    expect(outcome).toMatchObject({ type: "tool.failed", agent: "main" });
    expect(String(outcome?.error)).toContain("bulk-reader");
  });

  it("allows the same read from a sub-agent", async () => {
    const sessions = service([
      { steps: [{ type: "subagent", agentName: "bulk-reader", model: "model-a", steps: [view(join(repo, "schema.sql"))] }] },
    ]);
    const sessionId = await startSession(sessions);
    await runTurn(sessions, sessionId, "ask bulk-reader about the schema");

    expect(toolOutcomes(sessionId)).toEqual([{ type: "tool.completed", agent: "bulk-reader" }]);
  });

  it("allows a 10 KB read and a 300-line ranged read of the large file", async () => {
    const sessions = service([{ steps: [view("small.ts"), view("schema.sql", [100, 399])] }]);
    const sessionId = await startSession(sessions);
    await runTurn(sessions, sessionId, "read both");

    expect(toolOutcomes(sessionId)).toEqual([
      { type: "tool.completed", agent: "main" },
      { type: "tool.completed", agent: "main" },
    ]);
  });

  it("applies a changed read.minBytes in workspace config without restarting the session", async () => {
    const sessions = service([{ steps: [view("small.ts")] }, { steps: [view("small.ts")] }]);
    const sessionId = await startSession(sessions);
    await runTurn(sessions, sessionId, "first read");
    await writeFile(workspaceConfig, '{ "routing": { "delegation": { "read": { "minBytes": 8192 } } } }\n');
    await runTurn(sessions, sessionId, "second read");

    expect(toolOutcomes(sessionId)).toMatchObject([
      { type: "tool.completed", agent: "main" },
      { type: "tool.failed", agent: "main" },
    ]);
    expect(String(toolOutcomes(sessionId)[1]?.error)).toContain("8192-byte limit");
  });

  it("stops a code-writer delegation at its tool-call limit (C-11)", async () => {
    await writeFile(workspaceConfig, '{ "routing": { "delegation": { "codeWriter": { "maxToolCalls": 2 } } } }\n');
    const edit = { type: "toolCall", name: "edit", arguments: { path: join(repo, "small.ts"), old_str: "x", new_str: "y" }, result: "ok" };
    const sessions = service([
      { steps: [{ type: "subagent", agentName: "code-writer", model: "model-a", steps: [edit, edit, edit, edit] }, view("small.ts")] },
    ]);
    const sessionId = await startSession(sessions);
    await runTurn(sessions, sessionId, "ask code-writer for four edits");

    const outcomes = toolOutcomes(sessionId);
    expect(outcomes.map(({ type, agent }) => ({ type, agent }))).toEqual([
      { type: "tool.completed", agent: "code-writer" },
      { type: "tool.completed", agent: "code-writer" },
      { type: "tool.failed", agent: "code-writer" },
      { type: "tool.failed", agent: "code-writer" },
      { type: "tool.completed", agent: "main" },
    ]);
    expect(String(outcomes[2]?.error)).toContain("limit of 2 tool calls");
  });

  it("ends a code-writer delegation at its first limit denial, however many calls it makes after (C-11)", async () => {
    // The 2026-11-17 live run: a `license-headers` delegation hit the call limit after 12 `view`
    // calls and kept calling `view` through 24 denials. No call past the limit runs, a write included.
    await writeFile(workspaceConfig, '{ "routing": { "delegation": { "codeWriter": { "maxToolCalls": 2 } } } }\n');
    const small = { type: "toolCall", name: "create", arguments: { path: join(repo, "new.ts"), file_text: "x" }, result: "ok" };
    const ignoresDenials = [view("small.ts", [1, 5]), view("small.ts", [6, 10]), ...Array.from({ length: 6 }, () => view("small.ts", [1, 5])), small];
    const sessions = service([
      {
        steps: [
          { type: "subagent", agentName: "code-writer", model: "model-a", steps: ignoresDenials },
          { type: "subagent", agentName: "code-writer", model: "model-a", steps: [small] },
          view("small.ts"),
        ],
      },
    ]);
    const sessionId = await startSession(sessions);
    await runTurn(sessions, sessionId, "ask code-writer for headers");

    const outcomes = toolOutcomes(sessionId);
    expect(outcomes.map(({ type, agent }) => ({ type, agent }))).toEqual([
      { type: "tool.completed", agent: "code-writer" },
      { type: "tool.completed", agent: "code-writer" },
      ...Array.from({ length: 7 }, () => ({ type: "tool.failed", agent: "code-writer" })),
      { type: "tool.completed", agent: "code-writer" },
      { type: "tool.completed", agent: "main" },
    ]);
    expect(String(outcomes[2]?.error)).toContain("so it has ended");
    expect(String(outcomes[3]?.error)).toContain("1 call has been denied since");
    expect(String(outcomes[8]?.error)).toContain("6 calls have been denied since");
    expect(String(outcomes[8]?.error)).toContain("Do not call any tool");
  });

  it("lets the main agent read an excluded path whole", async () => {
    await writeFile(workspaceConfig, '{ "routing": { "delegation": { "read": { "exclude": ["*.sql"] } } } }\n');
    const sessions = service([{ steps: [view("schema.sql")] }]);
    const sessionId = await startSession(sessions);
    await runTurn(sessions, sessionId, "read the schema");

    expect(toolOutcomes(sessionId)).toEqual([{ type: "tool.completed", agent: "main" }]);
  });
});
