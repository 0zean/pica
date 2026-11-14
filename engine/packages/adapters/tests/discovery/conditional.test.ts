import { afterEach, describe, expect, it } from "vitest";
import { defaultDiscoveryFilter, syncRepoSource, type DiscoverySelector } from "@pica/core";
import { listingRoutes, numberedRepos, repoJson, startDiscoveryStub, teamReposPath, type DiscoveryStub, type ListingState } from "./stub-listing.ts";

let running: DiscoveryStub | undefined;

afterEach(async () => {
  await running?.stub.close();
  running = undefined;
});

const team: DiscoverySelector = { kind: "team", org: "acme", teamSlug: "platform" };
const first = { filter: defaultDiscoveryFilter, now: "2026-11-14T00:00:00.000Z" };
const second = { filter: defaultDiscoveryFilter, now: "2026-11-14T01:00:00.000Z" };

describe("conditional requests", () => {
  it("makes no changes and issues no further requests when the first page answers 304", async () => {
    const state: ListingState = { items: numberedRepos(250).map((repo) => repoJson("acme", repo)), etag: '"v1"' };
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, state));
    const initial = await syncRepoSource(running.client, team, null, first);
    if (!initial.ok) throw new Error(initial.error.message);
    expect(running.stub.requests).toHaveLength(3);
    const snapshotBefore = structuredClone(initial.value.snapshot);

    const revalidated = await syncRepoSource(running.client, team, initial.value.snapshot, second);
    if (!revalidated.ok) throw new Error(revalidated.error.message);

    expect(running.stub.requests).toHaveLength(4);
    expect(running.stub.requests[3]).toMatchObject({ path: `/api/v3${teamReposPath}`, ifNoneMatch: '"v1"' });
    expect(revalidated.value.notModified).toBe(true);
    expect(revalidated.value.snapshot).toBe(initial.value.snapshot);
    expect(revalidated.value.snapshot).toEqual(snapshotBefore);
    expect(revalidated.value.added).toEqual([]);
    expect(revalidated.value.removed).toEqual([]);
    expect(revalidated.value.repos).toHaveLength(250);
  });

  it("refetches every page when the ETag no longer matches", async () => {
    const state: ListingState = { items: numberedRepos(250).map((repo) => repoJson("acme", repo)), etag: '"v1"' };
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, state));
    const initial = await syncRepoSource(running.client, team, null, first);
    if (!initial.ok) throw new Error(initial.error.message);
    state.etag = '"v2"';

    const changed = await syncRepoSource(running.client, team, initial.value.snapshot, second);
    if (!changed.ok) throw new Error(changed.error.message);

    expect(running.stub.requests).toHaveLength(6);
    expect(running.stub.requests.slice(3).map((request) => request.ifNoneMatch)).toEqual(['"v1"', undefined, undefined]);
    expect(changed.value.notModified).toBe(false);
    expect(changed.value.snapshot.etag).toBe('"v2"');
    expect(changed.value.snapshot.syncedAt).toBe(second.now);
  });

  it("sends no If-None-Match on a first sync", async () => {
    const state: ListingState = { items: [repoJson("acme", { name: "one" })], etag: '"v1"' };
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, state));
    await syncRepoSource(running.client, team, null, first);
    expect(running.stub.requests.map((request) => request.ifNoneMatch)).toEqual([undefined]);
  });
});
