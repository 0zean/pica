import { afterEach, describe, expect, it } from "vitest";
import { defaultDiscoveryFilter, diffRepos, syncRepoSource, type DiscoveredRepo, type DiscoverySelector } from "@pica/core";
import {
  listingRoutes,
  numberedRepos,
  repoJson,
  startDiscoveryStub,
  teamReposPath,
  type DiscoveryStub,
  type ListingState,
} from "./stub-listing.ts";

let running: DiscoveryStub | undefined;

afterEach(async () => {
  await running?.stub.close();
  running = undefined;
});

const team: DiscoverySelector = { kind: "team", org: "acme", teamSlug: "platform" };
const options = { filter: defaultDiscoveryFilter, now: "2026-11-14T00:00:00.000Z" };

const names = (repos: readonly DiscoveredRepo[]): string[] => repos.map((repo) => repo.fullName);

describe("sync diff", () => {
  it("reports exactly the repos added and removed between two syncs", async () => {
    const base = numberedRepos(250);
    const state: ListingState = { items: base.map((repo) => repoJson("acme", repo)), etag: '"v1"' };
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, state));
    const initial = await syncRepoSource(running.client, team, null, options);
    if (!initial.ok) throw new Error(initial.error.message);

    const removed = new Set(["svc-000", "svc-120", "svc-249"]);
    const next = [
      ...base.filter((repo) => !removed.has(repo.name)),
      { name: "new-gateway" },
      { name: "new-auth" },
    ];
    state.items = next.map((repo) => repoJson("acme", repo));
    state.etag = '"v2"';

    const synced = await syncRepoSource(running.client, team, initial.value.snapshot, options);
    if (!synced.ok) throw new Error(synced.error.message);
    expect(names(synced.value.added)).toEqual(["acme/new-auth", "acme/new-gateway"]);
    expect(names(synced.value.removed)).toEqual(["acme/svc-000", "acme/svc-120", "acme/svc-249"]);
    expect(synced.value.repos).toHaveLength(249);
  });

  it("counts a repo that becomes archived as removed under the default filter", async () => {
    const state: ListingState = {
      items: [repoJson("acme", { name: "api" }), repoJson("acme", { name: "tool" })],
      etag: '"v1"',
    };
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, state));
    const initial = await syncRepoSource(running.client, team, null, options);
    if (!initial.ok) throw new Error(initial.error.message);
    state.items = [repoJson("acme", { name: "api" }), repoJson("acme", { name: "tool", archived: true })];
    state.etag = '"v2"';

    const synced = await syncRepoSource(running.client, team, initial.value.snapshot, options);
    if (!synced.ok) throw new Error(synced.error.message);
    expect(names(synced.value.added)).toEqual([]);
    expect(names(synced.value.removed)).toEqual(["acme/tool"]);
  });

  it("reports nothing when the listing is reordered but unchanged", async () => {
    const items = numberedRepos(5).map((repo) => repoJson("acme", repo));
    const state: ListingState = { items, etag: '"v1"' };
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, state));
    const initial = await syncRepoSource(running.client, team, null, options);
    if (!initial.ok) throw new Error(initial.error.message);
    state.items = [...items].reverse();
    state.etag = '"v2"';

    const synced = await syncRepoSource(running.client, team, initial.value.snapshot, options);
    if (!synced.ok) throw new Error(synced.error.message);
    expect(synced.value.notModified).toBe(false);
    expect(synced.value.added).toEqual([]);
    expect(synced.value.removed).toEqual([]);
  });
});

describe("diffRepos", () => {
  const repo = (remoteUrl: string): DiscoveredRepo => ({
    remoteUrl,
    fullName: remoteUrl.split("/").slice(-2).join("/"),
    cloneUrl: `${remoteUrl}.git`,
    defaultBranch: "main",
    archived: false,
    fork: false,
    topics: [],
    customProperties: {},
  });

  it("compares by identity and sorts each side", () => {
    const before = [repo("https://h.test/a/c"), repo("https://h.test/a/a"), repo("https://h.test/a/b")];
    const after = [repo("https://h.test/a/d"), repo("https://h.test/a/b"), repo("https://h.test/a/0")];
    const diff = diffRepos(before, after);
    expect(diff.added.map((r) => r.remoteUrl)).toEqual(["https://h.test/a/0", "https://h.test/a/d"]);
    expect(diff.removed.map((r) => r.remoteUrl)).toEqual(["https://h.test/a/a", "https://h.test/a/c"]);
  });

  it("is empty for identical sets", () => {
    const repos = [repo("https://h.test/a/a"), repo("https://h.test/a/b")];
    expect(diffRepos(repos, [...repos].reverse())).toEqual({ added: [], removed: [] });
  });
});
