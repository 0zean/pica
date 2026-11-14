import { afterEach, describe, expect, it } from "vitest";
import { listTeamRepos, syncRepoSource, type DiscoveryFilter } from "@pica/core";
import { listingRoutes, repoJson, startDiscoveryStub, teamReposPath, type DiscoveryStub } from "./stub-listing.ts";

let running: DiscoveryStub | undefined;

afterEach(async () => {
  await running?.stub.close();
  running = undefined;
});

const items = [
  repoJson("acme", { name: "api" }),
  repoJson("acme", { name: "legacy", archived: true }),
  repoJson("acme", { name: "upstream-fork", fork: true }),
  repoJson("acme", { name: "old-fork", archived: true, fork: true }),
];

const cases: readonly { filter: DiscoveryFilter; expected: string[] }[] = [
  { filter: { includeArchived: false, includeForks: false }, expected: ["acme/api"] },
  { filter: { includeArchived: true, includeForks: false }, expected: ["acme/api", "acme/legacy"] },
  { filter: { includeArchived: false, includeForks: true }, expected: ["acme/api", "acme/upstream-fork"] },
  {
    filter: { includeArchived: true, includeForks: true },
    expected: ["acme/api", "acme/legacy", "acme/upstream-fork", "acme/old-fork"],
  },
];

describe("archived and fork filter", () => {
  it("excludes archived repos and forks by default", async () => {
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, { items, etag: '"v1"' }));
    const result = await listTeamRepos(running.client, "acme", "platform");
    expect(result.ok ? result.value.map((repo) => repo.fullName) : result.error).toEqual(["acme/api"]);
  });

  for (const { filter, expected } of cases) {
    it(`archived ${String(filter.includeArchived)}, forks ${String(filter.includeForks)}`, async () => {
      running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, { items, etag: '"v1"' }));
      const listed = await listTeamRepos(running.client, "acme", "platform", filter);
      expect(listed.ok ? listed.value.map((repo) => repo.fullName) : listed.error).toEqual(expected);

      const synced = await syncRepoSource(
        running.client,
        { kind: "team", org: "acme", teamSlug: "platform" },
        null,
        { filter, now: "2026-11-14T00:00:00.000Z" },
      );
      if (!synced.ok) throw new Error(synced.error.message);
      expect(synced.value.repos.map((repo) => repo.fullName)).toEqual(expected);
      expect(synced.value.snapshot.repos).toHaveLength(4);
    });
  }

  it("applies a changed setting to a 304 revalidation without refetching", async () => {
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, { items, etag: '"v1"' }));
    const team = { kind: "team", org: "acme", teamSlug: "platform" } as const;
    const initial = await syncRepoSource(running.client, team, null, {
      filter: { includeArchived: false, includeForks: false },
      now: "2026-11-14T00:00:00.000Z",
    });
    if (!initial.ok) throw new Error(initial.error.message);
    const widened = await syncRepoSource(running.client, team, initial.value.snapshot, {
      filter: { includeArchived: true, includeForks: true },
      now: "2026-11-14T01:00:00.000Z",
    });
    if (!widened.ok) throw new Error(widened.error.message);
    expect(widened.value.notModified).toBe(true);
    expect(widened.value.repos).toHaveLength(4);
  });
});
