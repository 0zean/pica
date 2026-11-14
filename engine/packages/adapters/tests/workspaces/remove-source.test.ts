import type { Repo } from "@pica/core";
import { afterEach, describe, expect, it } from "vitest";
import { value } from "../repo-registry/helpers.ts";
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

const teamRepos = ["billing", "ledger", "payouts"].map((name) => repoJson("acme", { name }));

interface Synced {
  readonly fixture: WorkspaceFixture;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly byName: (name: string) => Repo;
}

async function syncedTeam(): Promise<Synced> {
  const stub = await startDiscoveryStub((current) => listingRoutes(current, teamReposPath, { items: teamRepos, etag: '"v1"' }));
  running = stub;
  const created = createWorkspaceFixture(() => stub.client);
  fixture = created;
  const workspaceId = value(created.workspaces.create("Payments")).id;
  const sourceId = value(created.workspaces.addSource(workspaceId, { kind: "team", org: "acme", selector: "platform" })).id;
  value(await created.workspaces.sync(workspaceId));
  const repos = value(created.workspaces.repos(workspaceId));
  const byName = (name: string): Repo => {
    const repo = repos.find((candidate) => candidate.remoteUrl.endsWith(`/${name}`));
    if (repo === undefined) throw new Error(`no repo ${name}`);
    return repo;
  };
  return { fixture: created, workspaceId, sourceId, byName };
}

describe("removing a source", () => {
  it("keeps pinned repos in the workspace and drops the rest", async () => {
    const { fixture: current, workspaceId, sourceId, byName } = await syncedTeam();
    const billing = byName("billing");
    value(current.workspaces.pinRepo(workspaceId, billing.id));

    value(current.workspaces.removeSource(workspaceId, sourceId));

    const workspace = value(current.workspaces.get(workspaceId));
    expect(workspace.sources).toEqual([]);
    expect(workspace.pinnedRepoIds).toEqual([billing.id]);
    expect(value(current.workspaces.repos(workspaceId))).toEqual([billing]);
  });

  it("forgets never-cloned repos nothing else uses and keeps cloned ones registered", async () => {
    const { fixture: current, workspaceId, sourceId, byName } = await syncedTeam();
    const billing = byName("billing");
    const ledger = { ...byName("ledger"), cloneState: "ready" as const, localPath: "/tmp/pica-test/acme/ledger" };
    value(current.store.repos.save(ledger));
    value(current.workspaces.pinRepo(workspaceId, billing.id));

    value(current.workspaces.removeSource(workspaceId, sourceId));

    expect(value(current.workspaces.repos())).toEqual([billing, ledger].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("keeps repos another workspace still includes", async () => {
    const { fixture: current, workspaceId, sourceId, byName } = await syncedTeam();
    const other = value(current.workspaces.create("Ops")).id;
    value(current.workspaces.pinRepo(other, byName("payouts").id));

    value(current.workspaces.removeSource(workspaceId, sourceId));

    expect(value(current.workspaces.repos(workspaceId))).toEqual([]);
    expect(value(current.workspaces.repos())).toEqual([byName("payouts")]);
  });

  it("answers not found for an unknown source", async () => {
    const { fixture: current, workspaceId } = await syncedTeam();
    const removed = current.workspaces.removeSource(workspaceId, "missing");
    expect(removed.ok ? undefined : removed.error.code).toBe("workspace.source_not_found");
  });
});
