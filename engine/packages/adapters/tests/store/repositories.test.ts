import type { Store, StoreResult } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSqliteStore } from "../../src/store/index.ts";
import { sampleRepo, sampleSession, sampleWorkspace, value } from "./helpers.ts";

function errorCode(result: StoreResult<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

describe("sqlite store repositories", () => {
  let store: Store;
  beforeEach(() => {
    store = value(openSqliteStore(":memory:"));
  });
  afterEach(() => {
    store.close();
  });

  it("round-trip and update repos, and keep remote URLs unique", () => {
    value(store.repos.save(sampleRepo));
    value(store.repos.save({ ...sampleRepo, cloneState: "failed", managed: true }));
    expect(value(store.repos.get(sampleRepo.id))).toEqual({ ...sampleRepo, cloneState: "failed", managed: true });
    expect(value(store.repos.findByRemoteUrl(sampleRepo.remoteUrl)).id).toBe(sampleRepo.id);
    expect(errorCode(store.repos.save({ ...sampleRepo, id: "repo-2" }))).toBe("store.conflict");
    expect(errorCode(store.repos.get("missing"))).toBe("store.not_found");
    expect(value(store.repos.list())).toHaveLength(1);
  });

  it("round-trip workspaces with ordered pins, and reject a pin to an unknown repo atomically", () => {
    value(store.repos.save(sampleRepo));
    value(store.repos.save({ ...sampleRepo, id: "repo-0", remoteUrl: "github.com/acme/web" }));
    const workspace = { ...sampleWorkspace, pinnedRepoIds: ["repo-1", "repo-0"] };
    value(store.workspaces.save(workspace));
    expect(value(store.workspaces.get(workspace.id))).toEqual(workspace);

    const result = store.workspaces.save({ ...workspace, name: "Renamed", pinnedRepoIds: ["nope"] });
    expect(errorCode(result)).toBe("store.conflict");
    expect(value(store.workspaces.get(workspace.id))).toEqual(workspace);
    expect(value(store.workspaces.list())).toEqual([workspace]);
  });

  it("create sessions, list them by workspace, and update their state", () => {
    value(store.repos.save(sampleRepo));
    value(store.workspaces.save(sampleWorkspace));
    value(store.sessions.create(sampleSession("session-1")));
    expect(errorCode(store.sessions.create(sampleSession("session-1")))).toBe("store.conflict");
    expect(errorCode(store.sessions.create({ ...sampleSession("s"), workspaceId: "none" }))).toBe(
      "store.conflict",
    );
    value(store.sessions.updateState("session-1", "resumable", "2026-11-12T11:00:00.000Z"));
    expect(value(store.sessions.listByWorkspace(sampleWorkspace.id))).toEqual([
      { ...sampleSession("session-1"), state: "resumable", updatedAt: "2026-11-12T11:00:00.000Z" },
    ]);
    expect(errorCode(store.sessions.updateState("missing", "idle", "t"))).toBe("store.not_found");
    expect(errorCode(store.workspaces.delete(sampleWorkspace.id))).toBe("store.conflict");
  });

  it("record usage in order and reject events for an unknown session", () => {
    value(store.repos.save(sampleRepo));
    value(store.workspaces.save(sampleWorkspace));
    value(store.sessions.create(sampleSession("session-1")));
    const usage = {
      sessionId: "session-1",
      agent: "main",
      model: "model-a",
      inputTokens: 120,
      cachedTokens: 100,
      outputTokens: 8,
      credits: 0.25,
      timestamp: "2026-11-12T10:00:00.000Z",
    };
    value(store.usage.record(usage));
    value(store.usage.record({ ...usage, agent: "worker" }));
    expect(value(store.usage.listBySession("session-1")).map((record) => record.agent)).toEqual([
      "main",
      "worker",
    ]);
    expect(errorCode(store.usage.record({ ...usage, inputTokens: -1 }))).toBe("store.conflict");
    expect(errorCode(store.events.append("missing", { type: "t", payload: null, timestamp: "t" }))).toBe(
      "store.conflict",
    );
    expect(value(store.events.lastSeq("missing"))).toBe(0);
  });

  it("delete a workspace and its pins", () => {
    value(store.repos.save(sampleRepo));
    value(store.workspaces.save(sampleWorkspace));
    value(store.workspaces.delete(sampleWorkspace.id));
    expect(errorCode(store.workspaces.get(sampleWorkspace.id))).toBe("store.not_found");
    expect(errorCode(store.workspaces.delete(sampleWorkspace.id))).toBe("store.not_found");
  });
});
