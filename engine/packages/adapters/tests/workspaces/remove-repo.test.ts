import type { Repo } from "@pica/core";
import { afterEach, describe, expect, it } from "vitest";
import { value } from "../repo-registry/helpers.ts";
import { sampleSession } from "../store/helpers.ts";
import { listingRoutes, repoJson, startDiscoveryStub, teamReposPath, type DiscoveryStub } from "../discovery/stub-listing.ts";
import { createWorkspaceFixture, type WorkspaceFixture } from "./helpers.ts";

let running: DiscoveryStub | undefined;
let fixture: WorkspaceFixture | undefined;

afterEach(async () => {
  await running?.stub.close();
  running = undefined;
  fixture?.dispose();
  fixture = undefined;
});

const teamRepos = ["billing", "ledger"].map((name) => repoJson("acme", { name }));

interface Synced {
  readonly current: WorkspaceFixture;
  readonly workspaceId: string;
  readonly byName: (name: string) => Repo;
  readonly names: () => string[];
}

async function syncedTeam(): Promise<Synced> {
  const stub = await startDiscoveryStub((state) => listingRoutes(state, teamReposPath, { items: teamRepos, etag: '"v1"' }));
  running = stub;
  const current = createWorkspaceFixture(() => stub.client);
  fixture = current;
  const workspaceId = value(current.workspaces.create("Payments")).id;
  value(current.workspaces.addSource(workspaceId, { kind: "team", org: "acme", selector: "platform" }));
  value(await current.workspaces.sync(workspaceId));
  const repos = value(current.workspaces.repos(workspaceId));
  const byName = (name: string): Repo => {
    const repo = repos.find((candidate) => candidate.remoteUrl.endsWith(`/${name}`));
    if (repo === undefined) throw new Error(`no repo ${name}`);
    return repo;
  };
  const names = (): string[] =>
    value(current.workspaces.repos(workspaceId)).map((repo) => repo.remoteUrl.split("/").at(-1) ?? "");
  return { current, workspaceId, byName, names };
}

describe("removing a repo from a workspace", () => {
  it("keeps a team-sourced repo out on later syncs", async () => {
    const { current, workspaceId, byName, names } = await syncedTeam();

    value(current.workspaces.removeRepo(workspaceId, byName("billing").id));
    expect(names()).toEqual(["ledger"]);

    const synced = value(await current.workspaces.sync(workspaceId));
    expect(synced).toEqual({ added: [], removed: [] });
    expect(names()).toEqual(["ledger"]);
    expect(value(current.workspaces.get(workspaceId)).sources[0]?.excludedRemoteUrls).toEqual([
      byName("billing").remoteUrl,
    ]);
  });

  it("unpins a pinned repo that a source also lists, and forgets it once nothing uses it and it was never cloned", async () => {
    const { current, workspaceId, byName, names } = await syncedTeam();
    const billing = byName("billing");
    value(current.workspaces.pinRepo(workspaceId, billing.id));

    value(current.workspaces.removeRepo(workspaceId, billing.id));

    expect(value(current.workspaces.get(workspaceId)).pinnedRepoIds).toEqual([]);
    expect(names()).toEqual(["ledger"]);
    expect(value(current.workspaces.repos()).map((repo) => repo.id)).not.toContain(billing.id);
  });

  it("keeps a cloned repo registered", async () => {
    const { current, workspaceId, byName } = await syncedTeam();
    const ledger = { ...byName("ledger"), cloneState: "ready" as const, localPath: "/tmp/pica-test/acme/ledger" };
    value(current.store.repos.save(ledger));

    value(current.workspaces.removeRepo(workspaceId, ledger.id));

    expect(value(current.workspaces.repo(ledger.id))).toEqual(ledger);
  });

  it("answers not found for a repo the workspace does not include", async () => {
    const { current, workspaceId } = await syncedTeam();
    const removed = current.workspaces.removeRepo(workspaceId, "missing");
    expect(removed.ok ? undefined : removed.error.code).toBe("workspace.repo_not_found");
  });
});

describe("deleting a workspace", () => {
  it("refuses while a session is open, then deletes it with its ended sessions and forgets never-cloned repos", async () => {
    const { current, workspaceId, byName } = await syncedTeam();
    const ledger = { ...byName("ledger"), cloneState: "ready" as const, localPath: "/tmp/pica-test/acme/ledger" };
    value(current.store.repos.save(ledger));
    value(current.store.sessions.create({ ...sampleSession("session-1"), workspaceId, state: "running" }));

    const refused = current.workspaces.delete(workspaceId);
    expect(refused.ok ? undefined : refused.error.code).toBe("workspace.in_use");
    expect(refused.ok ? "" : refused.error.message).toContain("end them before deleting the workspace");

    value(current.store.sessions.updateState("session-1", "ended", "2026-11-14T00:00:00.000Z"));
    value(current.workspaces.delete(workspaceId));

    const gone = current.workspaces.get(workspaceId);
    expect(gone.ok ? undefined : gone.error.code).toBe("workspace.not_found");
    expect(value(current.store.sessions.listByWorkspace(workspaceId))).toEqual([]);
    expect(value(current.workspaces.repos())).toEqual([ledger]);
  });
});
