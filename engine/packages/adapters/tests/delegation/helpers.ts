import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, expect } from "vitest";
import { createEventLog, createRuntimeNativeDelegator, createSessionService } from "@pica/core";
import type { AgentRuntime, Delegator, SessionEvent, SessionService, Store, TierResolution } from "@pica/core";
import type { Tier } from "@pica/protocol";
import { FakeRuntime, scenarioSchema, sequentialIds, steppingClock } from "@pica/testkit";
import { builtinAgentsDir, MarkdownAgentLoader, openSqliteStore } from "../../src/index.ts";

export const workspaceId = "ws-1";
export const repoId = "repo-1";

export interface Harness {
  readonly dir: string;
  readonly store: Store;
  close(): void;
}

export function openHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), "pica-delegation-"));
  const opened = openSqliteStore(join(dir, "pica.db"));
  if (!opened.ok) {
    throw new Error(opened.error.message);
  }
  const store = opened.value;
  store.repos.save({ id: repoId, remoteUrl: "github.com/acme/api", localPath: dir, managed: false, defaultBranch: "main", cloneState: "ready" });
  store.workspaces.save({ id: workspaceId, name: "Payments", sources: [], pinnedRepoIds: [], settingsOverrides: {} });
  return {
    dir,
    store,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const builtinAgents = (): MarkdownAgentLoader => new MarkdownAgentLoader([{ layer: "builtin", dir: builtinAgentsDir }]);

// Tier resolution as on a default-model-only plan unless `models` names a model per tier.
export function tierResolver(models: Partial<Record<Tier, string>> = {}): (tier: Tier) => Promise<TierResolution> {
  return (tier) => {
    const model = models[tier];
    return Promise.resolve(
      model === undefined
        ? { tier, setting: "auto", resolvedModelId: null, reason: "unresolved" }
        : { tier, setting: model, resolvedModelId: model, reason: "configured" },
    );
  };
}

export function builtinDelegator(models: Partial<Record<Tier, string>> = {}): Delegator {
  return createRuntimeNativeDelegator({ agents: builtinAgents(), resolveTier: tierResolver(models) });
}

export function fakeRuntime(turns: unknown[]): FakeRuntime {
  const scenario = scenarioSchema.parse({
    version: 1,
    models: [{ id: "model-a", name: "Model A" }],
    defaultModel: "model-a",
    turns,
  });
  return new FakeRuntime({ scenario });
}

export function sessionService(harness: Harness, runtime: AgentRuntime, delegator: Delegator): SessionService {
  const ids = sequentialIds();
  return createSessionService({
    store: harness.store,
    events: createEventLog(harness.store.events),
    runtime,
    clock: steppingClock("2026-11-15T09:00:00.000Z"),
    newSessionId: () => ids("session"),
    delegator,
  });
}

export async function startSession(sessions: SessionService): Promise<string> {
  const created = await sessions.create({ workspaceId, writeRepoIds: [repoId], referenceRepoIds: [] });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  return created.value.id;
}

export async function runTurn(harness: Harness, sessions: SessionService, sessionId: string, text: string): Promise<void> {
  const sent = await sessions.send(sessionId, text, "send");
  expect(sent).toEqual({ ok: true, value: { accepted: true } });
  await vi.waitFor(() => {
    expect(harness.store.sessions.get(sessionId)).toMatchObject({ ok: true, value: { state: "idle" } });
  });
}

export function sessionEvents(harness: Harness, sessionId: string): readonly SessionEvent[] {
  const events = harness.store.events.readAfter(sessionId, 0);
  if (!events.ok) {
    throw new Error(events.error.message);
  }
  return events.value;
}

export function payload(event: SessionEvent | undefined): Record<string, unknown> {
  const value: unknown = event?.payload;
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
