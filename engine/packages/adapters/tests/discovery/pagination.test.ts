import { afterEach, describe, expect, it } from "vitest";
import { defaultDiscoveryFilter, listTeamRepos, nextPageUrl, selectorForSource, syncRepoSource } from "@pica/core";
import {
  numberedRepos,
  orgReposPath,
  listingRoutes,
  repoJson,
  startDiscoveryStub,
  teamReposPath,
  type DiscoveryStub,
} from "./stub-listing.ts";

let running: DiscoveryStub | undefined;

afterEach(async () => {
  await running?.stub.close();
  running = undefined;
});

const now = "2026-11-14T00:00:00.000Z";

describe("pagination", () => {
  it("discovers all 250 repos of a team across 3 pages", async () => {
    const items = numberedRepos(250).map((repo) => repoJson("acme", repo));
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, { items, etag: '"v1"' }));
    const result = await listTeamRepos(running.client, "acme", "platform");
    expect(result.ok).toBe(true);
    const repos = result.ok ? result.value : [];
    expect(repos).toHaveLength(250);
    expect(new Set(repos.map((repo) => repo.remoteUrl)).size).toBe(250);
    expect(repos[0]?.remoteUrl).toBe("https://ghe.example.test/acme/svc-000");
    expect(repos[249]?.fullName).toBe("acme/svc-249");
    expect(running.stub.requests.map((request) => request.path)).toEqual([
      `/api/v3${teamReposPath}`,
      `/api/v3${teamReposPath}&page=2`,
      `/api/v3${teamReposPath}&page=3`,
    ]);
  });

  it("syncs a 250-repo team source across 3 pages and keeps the first page's ETag", async () => {
    const items = numberedRepos(250).map((repo) => repoJson("acme", repo));
    running = await startDiscoveryStub((stub) => listingRoutes(stub, teamReposPath, { items, etag: '"v1"' }));
    const selector = selectorForSource({ kind: "team", org: "acme", selector: "platform" });
    if (!selector.ok) throw new Error(selector.error.message);
    const result = await syncRepoSource(running.client, selector.value, null, { filter: defaultDiscoveryFilter, now });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.repos).toHaveLength(250);
    expect(result.value.added).toHaveLength(250);
    expect(result.value.removed).toEqual([]);
    expect(result.value.snapshot.etag).toBe('"v1"');
    expect(running.stub.requests).toHaveLength(3);
    expect(running.stub.requests.every((request) => request.authorization === "Bearer ghp_test")).toBe(true);
  });

  it("filters a paginated organization listing by topic across every page", async () => {
    const items = numberedRepos(250).map((repo, index) =>
      repoJson("acme", { ...repo, topics: index % 50 === 0 ? ["Payments", "go"] : ["go"] }),
    );
    running = await startDiscoveryStub((stub) => listingRoutes(stub, orgReposPath, { items, etag: '"o1"' }));
    const selector = selectorForSource({ kind: "topic", org: "acme", selector: "payments" });
    if (!selector.ok) throw new Error(selector.error.message);
    const result = await syncRepoSource(running.client, selector.value, null, { filter: defaultDiscoveryFilter, now });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.repos.map((repo) => repo.fullName)).toEqual([
      "acme/svc-000",
      "acme/svc-050",
      "acme/svc-100",
      "acme/svc-150",
      "acme/svc-200",
    ]);
    expect(running.stub.requests).toHaveLength(3);
  });

  it("filters an organization listing by a custom property, including multi-select values", async () => {
    const items = [
      repoJson("acme", { name: "billing", properties: { team: "payments" } }),
      repoJson("acme", { name: "ledger", properties: { team: ["payments", "finance"] } }),
      repoJson("acme", { name: "web", properties: { team: "frontend" } }),
      repoJson("acme", { name: "unset", properties: { team: null } }),
    ];
    running = await startDiscoveryStub((stub) => listingRoutes(stub, orgReposPath, { items, etag: '"o1"' }));
    const selector = selectorForSource({ kind: "property", org: "acme", selector: "team=payments" });
    if (!selector.ok) throw new Error(selector.error.message);
    const result = await syncRepoSource(running.client, selector.value, null, { filter: defaultDiscoveryFilter, now });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.repos.map((repo) => repo.fullName)).toEqual(["acme/billing", "acme/ledger"]);
  });
});

describe("nextPageUrl", () => {
  it("finds rel=next wherever it appears in the Link header", () => {
    expect(nextPageUrl('<https://a.test/x?page=1>; rel="prev", <https://a.test/x?page=3>; rel="next"')).toBe(
      "https://a.test/x?page=3",
    );
    expect(nextPageUrl('<https://a.test/x?page=2>; rel="next prefetch"')).toBe("https://a.test/x?page=2");
  });

  it("returns null on the last page or without a Link header", () => {
    expect(nextPageUrl('<https://a.test/x?page=1>; rel="first", <https://a.test/x?page=2>; rel="prev"')).toBeNull();
    expect(nextPageUrl(null)).toBeNull();
  });
});
