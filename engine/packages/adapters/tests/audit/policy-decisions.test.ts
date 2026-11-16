import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEventLog,
  createOutputGuard,
  createReadGate,
  createSessionService,
  defaultCommandDenyList,
  emitPolicyDecisions,
  openAuditLog,
  verifyAuditLines,
  withAuditLog,
  withOutputGuard,
} from "@pica/core";
import type { AuditEntry, AuditError, PolicyConfig, PolicyDecision, RuntimeHooks, SessionService, Store } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import {
  createJsonlAuditStore,
  createSessionArtifacts,
  fileSize,
  JsoncConfigLoader,
  openSqliteStore,
  sha256Hex,
} from "../../src/index.ts";

const workspaceId = "ws-1";
const repoId = "repo-1";
// Shaped like a GitHub token so a leak would be unmistakable; it is never a real credential.
const secret = "ghp_H02auditFixtureSecretValue000000000000";

let dir: string;
let repo: string;
let auditPath: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pica-audit-scenario-"));
  repo = join(dir, "repo");
  auditPath = join(dir, "audit", "audit.jsonl");
  await mkdir(repo);
  await writeFile(join(repo, "schema.sql"), "-- one line of SQL schema\n".repeat(8000));
  await writeFile(join(repo, "small.ts"), "x".repeat(10 * 1024));
  await writeFile(join(dir, "workspace.jsonc"), '{ "routing": { "delegation": { "output": { "maxBytes": 1024 } } } }\n');
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

const toolCall = (name: string, args: Record<string, unknown>, result = "contents"): unknown => ({ type: "toolCall", name, arguments: args, result });
const view = (path: string, viewRange?: [number, number]): unknown =>
  toolCall("view", viewRange === undefined ? { path } : { path, view_range: viewRange });

interface Audited {
  readonly sessions: SessionService;
  readonly decisions: { readonly sessionId: string; readonly decision: PolicyDecision }[];
  readonly auditErrors: AuditError[];
}

// The composition the engine uses: hooks report decisions as events, and the event log audits them.
function auditedService(turns: unknown[]): Audited {
  const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns });
  const loader = new JsoncConfigLoader([{ layer: "workspace", file: join(dir, "workspace.jsonc") }]);
  const config = (): PolicyConfig => {
    const loaded = loader.load();
    if (!loaded.ok) {
      throw new Error(loaded.error.message);
    }
    return loaded.value.config;
  };
  const audit = openAuditLog({ store: createJsonlAuditStore(auditPath), hash: sha256Hex });
  if (!audit.ok) {
    throw new Error(audit.error.message);
  }
  const auditErrors: AuditError[] = [];
  const events = withAuditLog(createEventLog(store.events), audit.value, (error) => auditErrors.push(error));
  const clock = steppingClock("2026-11-14T09:00:00.000Z");
  const emit = emitPolicyDecisions(events, clock);
  const decisions: Audited["decisions"] = [];
  const onDecision = (sessionId: string, decision: PolicyDecision): void => {
    decisions.push({ sessionId, decision });
    emit(sessionId, decision);
  };
  const readGate = createReadGate({ sessions: store.sessions, config, fileSize, onDecision });
  const guard = createOutputGuard({
    artifacts: createSessionArtifacts(join(dir, "sessions")),
    // The session's profile, as the composition passes it (D-22 made `off` the config default).
    policyContext: () => ({ cwd: repo, writeRoots: [repo], referenceRoots: [], config: { ...config(), routing: { ...config().routing, profile: "balanced" } }, managed: [], commandDenyList: defaultCommandDenyList }),
    onDecision,
  });
  const hooks = (sessionId: string): RuntimeHooks => {
    const gated = readGate(sessionId);
    return {
      onPreToolUse: async (input) =>
        input.toolName === "edit" ? { decision: "ask", reason: `edit with token ${secret}` } : (gated.onPreToolUse?.(input) ?? { decision: "allow" }),
    };
  };
  const ids = sequentialIds();
  const sessions = createSessionService({
    store,
    events,
    runtime: new FakeRuntime({ scenario }),
    clock,
    newSessionId: () => ids("session"),
    hooks: withOutputGuard(hooks, guard),
  });
  return { sessions, decisions, auditErrors };
}

async function startSession(sessions: SessionService): Promise<string> {
  const created = await sessions.create({ workspaceId, writeRepoIds: [repoId], referenceRepoIds: [], routingProfile: "balanced" });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  return created.value.id;
}

async function readAudit(): Promise<{ readonly text: string; readonly entries: AuditEntry[] }> {
  const text = await readFile(auditPath, "utf8");
  const lines = text.slice(0, -1).split("\n");
  expect(verifyAuditLines(lines, sha256Hex)).toMatchObject({ ok: true, value: { entries: lines.length } });
  return { text, entries: lines.map((line) => JSON.parse(line) as AuditEntry) };
}

async function waitForIdle(sessions: SessionService, sessionId: string): Promise<void> {
  await vi.waitFor(() => {
    expect(sessions.get(sessionId)).toMatchObject({ ok: true, value: { state: "idle" } });
  });
}

function field(entry: AuditEntry, key: string): string {
  const value = entry.data[key];
  return typeof value === "string" ? value : JSON.stringify(value);
}

const decisionKey = (sessionId: string, toolCallId: string, ruleId: string, outcome: string): string =>
  `${sessionId} ${toolCallId} ${ruleId} ${outcome}`;

describe("audit log of a FakeRuntime scenario", () => {
  it("records every policy decision exactly once, with tool calls and approvals, and no secrets", async () => {
    const { sessions, decisions, auditErrors } = auditedService([
      {
        steps: [
          view("schema.sql"),
          view("small.ts"),
          view("schema.sql", [100, 399]),
          view("/etc/hosts"),
          { type: "subagent", agentName: "bulk-reader", model: "model-a", steps: [view(join(repo, "schema.sql"))] },
          toolCall("bash", { command: `curl -H "Authorization: token ${secret}" https://api.github.com/user` }, `${secret}\n`.repeat(200)),
          toolCall("edit", { path: "README.md", new_str: secret }, "edited"),
          { type: "text", content: "Done." },
        ],
      },
      { steps: [view("small.ts"), view("schema.sql")] },
    ]);
    const sessionId = await startSession(sessions);

    expect(await sessions.send(sessionId, "first turn", "send")).toEqual({ ok: true, value: { accepted: true } });
    const approvalId = await vi.waitFor(() => {
      const pending = sessions.listApprovals(sessionId);
      const [first] = pending.ok ? pending.value : [];
      expect(first).toBeDefined();
      return first?.id ?? "";
    });
    expect(await sessions.resolveApproval(approvalId, "allow_once")).toEqual({ ok: true, value: undefined });
    await waitForIdle(sessions, sessionId);
    expect(await sessions.send(sessionId, "second turn", "send")).toEqual({ ok: true, value: { accepted: true } });
    await waitForIdle(sessions, sessionId);

    const { text, entries } = await readAudit();
    expect(auditErrors).toEqual([]);

    // 7 reads gated before use, 1 oversized result rewritten after.
    expect(decisions).toHaveLength(8);
    expect(decisions.map(({ decision }) => decision.ruleId).sort()).toEqual([
      "cost.large-read",
      "cost.large-read",
      "cost.oversized-output",
      "permission.read-only",
      "permission.read-only",
      "permission.read-only",
      "permission.read-only",
      "safety.outside-roots",
    ]);
    const made = decisions.map(({ sessionId: id, decision }) => decisionKey(id, decision.call.id, decision.ruleId, decision.outcome));
    const audited = entries
      .filter((entry) => entry.kind === "policy.decision")
      .map((entry) => decisionKey(entry.sessionId, field(entry, "toolCallId"), field(entry, "ruleId"), field(entry, "outcome")));
    expect(new Set(made).size).toBe(made.length);
    expect(audited.sort()).toEqual([...made].sort());

    const stored = store.events.readAfter(sessionId, 0);
    if (!stored.ok) {
      throw new Error(stored.error.message);
    }
    const audits = new Set(["tool.started", "tool.completed", "tool.failed", "policy.decision", "approval.requested", "approval.resolved"]);
    const auditable = stored.value.filter((event) => audits.has(event.type));
    expect(entries.map((entry) => [entry.eventSeq, entry.kind])).toEqual(auditable.map((event) => [event.seq, event.type]));
    expect(entries.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["approval.requested", "approval.resolved", "tool.failed"]));

    expect(text).not.toContain(secret);
    expect(text).not.toContain(secret.slice(4, 20));
    const events = JSON.stringify(stored.value);
    expect(events).toContain(secret);
  });
});
