import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PicaConfig } from "@pica/protocol";
import { createEventLog, createSessionService, userHookLifecycle } from "@pica/core";
import type { HookProcessRequest, HookRunReport, Store } from "@pica/core";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSqliteStore } from "../../src/index.ts";

let dir: string;
let repo: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pica-hook-session-"));
  repo = join(dir, "repo");
  await mkdir(repo);
  const opened = openSqliteStore(join(dir, "pica.db"));
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }
  store = opened.value;
  store.repos.save({ id: "repo-1", remoteUrl: "github.com/acme/api", localPath: repo, managed: false, defaultBranch: "main", cloneState: "ready" });
  store.workspaces.save({ id: "ws-1", name: "Payments", sources: [], pinnedRepoIds: [], settingsOverrides: {} });
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe("session lifecycle hooks", () => {
  it("run sessionStart once the runtime is ready and sessionEnd after the session ends, without blocking either", async () => {
    const ran: HookProcessRequest[] = [];
    const reports: [string, HookRunReport][] = [];
    const settings = PicaConfig.parse({
      hooks: { sessionStart: [{ command: "./setup.sh" }], sessionEnd: [{ name: "cleanup", command: "./cleanup.sh", timeoutSeconds: 5 }] },
    }).hooks;
    const lifecycle = userHookLifecycle(
      {
        runner: {
          run: (request) => {
            ran.push(request);
            return Promise.resolve({ kind: "exited", exitCode: request.command === "./cleanup.sh" ? 1 : 0, output: "" });
          },
        },
        settings: () => settings,
        decide: (call) => ({ outcome: "allow", ruleId: "permission.auto", ruleGroup: "permission", reason: "auto", call }),
      },
      (report, sessionId) => reports.push([sessionId, report]),
    );
    const scenario = scenarioSchema.parse({ version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: [] });
    const ids = sequentialIds();
    const sessions = createSessionService({
      store,
      events: createEventLog(store.events),
      runtime: new FakeRuntime({ scenario }),
      clock: steppingClock("2026-11-14T09:00:00.000Z"),
      newSessionId: () => ids("session"),
      lifecycle,
    });

    const created = await sessions.create({ workspaceId: "ws-1", writeRepoIds: ["repo-1"], referenceRepoIds: [] });
    if (!created.ok) {
      throw new Error(created.error.message);
    }
    const sessionId = created.value.id;
    expect(ran).toEqual([{ command: "./setup.sh", cwd: repo, timeoutMs: 60_000, env: { PICA_SESSION_ID: sessionId, PICA_HOOK_EVENT: "sessionStart" } }]);

    expect(await sessions.end(sessionId)).toEqual({ ok: true, value: undefined });
    expect(ran[1]).toMatchObject({ command: "./cleanup.sh", timeoutMs: 5000, env: { PICA_HOOK_EVENT: "sessionEnd" } });
    expect(store.sessions.get(sessionId)).toMatchObject({ ok: true, value: { state: "ended" } });
    expect(reports.map(([id, report]) => [id, report.event, report.failure?.code])).toEqual([
      [sessionId, "sessionStart", undefined],
      [sessionId, "sessionEnd", "hook.failed"],
    ]);
  });
});
