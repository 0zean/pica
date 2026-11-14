import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git, makeBareRemote, value } from "../repo-registry/helpers.ts";
import { listingRoutes, repoJson, startDiscoveryStub, teamReposPath, type DiscoveryStub } from "../discovery/stub-listing.ts";
import { createWorkspaceFixture, noDiscovery, type WorkspaceFixture } from "./helpers.ts";

let running: DiscoveryStub | undefined;
let fixture: WorkspaceFixture | undefined;

afterEach(async () => {
  await running?.stub.close();
  running = undefined;
  fixture?.dispose();
  fixture = undefined;
});

const teamRepos = ["billing", "ledger", "payouts"].map((name) => repoJson("acme", { name }));

async function teamFixture(): Promise<WorkspaceFixture> {
  const stub = await startDiscoveryStub((current) => listingRoutes(current, teamReposPath, { items: teamRepos, etag: '"v1"' }));
  running = stub;
  return createWorkspaceFixture(() => stub.client);
}

describe("team source", () => {
  it("adds the team's repos as available without cloning any", async () => {
    fixture = await teamFixture();
    const { workspaces } = fixture;
    const workspace = value(workspaces.create("Payments"));
    value(workspaces.addSource(workspace.id, { kind: "team", org: "acme", selector: "platform" }));

    const synced = value(await workspaces.sync(workspace.id));

    const repos = value(workspaces.repos(workspace.id));
    expect(synced.added).toHaveLength(3);
    expect(synced.removed).toEqual([]);
    expect(repos.map((repo) => repo.id)).toEqual(synced.added);
    expect(repos.map((repo) => repo.remoteUrl)).toEqual([
      "https://ghe.example.test/acme/billing",
      "https://ghe.example.test/acme/ledger",
      "https://ghe.example.test/acme/payouts",
    ]);
    for (const repo of repos) {
      expect(repo).toMatchObject({ cloneState: "absent", localPath: null, managed: true, defaultBranch: "main" });
    }
    expect(fixture.cloneRequests).toEqual([]);
    expect(existsSync(fixture.managedRoot)).toBe(false);
    const source = value(workspaces.get(workspace.id)).sources[0];
    expect(source?.lastSyncAt).toBe("2026-11-14T00:00:00.000Z");
    expect(source?.snapshot?.etag).toBe('"v1"');
  });

  it("keeps repos and ids stable when nothing changed upstream", async () => {
    fixture = await teamFixture();
    const { workspaces } = fixture;
    const workspace = value(workspaces.create("Payments"));
    value(workspaces.addSource(workspace.id, { kind: "team", org: "acme", selector: "platform" }));
    const first = value(await workspaces.sync(workspace.id));

    const second = value(await workspaces.sync(workspace.id));

    expect(second).toEqual({ added: [], removed: [] });
    expect(value(workspaces.repos(workspace.id)).map((repo) => repo.id)).toEqual(first.added);
    expect(fixture.store.repos.list()).toMatchObject({ ok: true, value: { length: 3 } });
  });

  it("clones an available repo the first time it is used, and only then", async () => {
    fixture = createWorkspaceFixture(noDiscovery);
    const remote = makeBareRemote(fixture.root, "acme", "widget");
    const remoteUrl = `file://${remote.replace(/\.git$/, "")}`;
    value(fixture.store.repos.save({ id: "widget", remoteUrl, localPath: null, managed: true, defaultBranch: "main", cloneState: "absent" }));

    const cloned = value(await fixture.workspaces.ensureCloned("widget"));
    const again = value(await fixture.workspaces.ensureCloned("widget"));

    expect(cloned).toMatchObject({ id: "widget", cloneState: "ready", localPath: join(fixture.managedRoot, "acme", "widget") });
    expect(again).toEqual(cloned);
    expect(fixture.cloneRequests).toEqual([remoteUrl]);
    expect(git(join(fixture.managedRoot, "acme", "widget"), "config", "remote.origin.partialclonefilter")).toBe("blob:none");
  });

  it("rejects a team source without an organization", () => {
    fixture = createWorkspaceFixture(noDiscovery);
    const workspace = value(fixture.workspaces.create("Payments"));
    const added = fixture.workspaces.addSource(workspace.id, { kind: "team", org: null, selector: "platform" });
    expect(added.ok ? undefined : added.error.code).toBe("workspace.invalid");
  });
});
