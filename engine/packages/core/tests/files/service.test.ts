import { describe, expect, it } from "vitest";
import { createFilesService, err, filesError, ok, repoToolError } from "../../src/index.ts";
import type { FileInfo, Repo, RepoFiles } from "../../src/index.ts";

// A-09: the listing is kept and listed again once it is older than `indexMaxAgeMs`; quick open
// answers from the old listing meanwhile, so a keystroke never waits for git.

function repo(id: string, cloneState: Repo["cloneState"] = "ready"): Repo {
  return { id, remoteUrl: `https://git.example.com/acme/${id}.git`, localPath: `/work/${id}`, managed: false, defaultBranch: "main", cloneState };
}

function harness(listings: Record<string, string[]>) {
  let now = 0;
  const calls: string[] = [];
  const repos = [repo("atlas"), repo("beacon"), repo("later", "absent")];
  const files: RepoFiles = {
    listFiles: (root) => {
      calls.push(root);
      const listing = listings[root];
      return Promise.resolve(listing === undefined ? err(repoToolError("repo_tools.io_failed", "no repo")) : ok(listing));
    },
    readFile: () => Promise.resolve(ok({ kind: "text", text: "", truncated: false })),
  };
  const service = createFilesService({
    workspaceRepos: (id) => (id === "w1" ? ok(repos) : err(filesError("files.workspace_not_found", "no workspace"))),
    repo: (id) => {
      const found = repos.find((entry) => entry.id === id);
      return found === undefined ? err(filesError("files.repo_not_found", "no repo")) : ok(found);
    },
    files,
    stat: (): Promise<FileInfo> => Promise.resolve({ kind: "file", sizeBytes: 1 }),
    realPath: (path) => Promise.resolve(path),
    now: () => now,
    limits: { indexMaxAgeMs: 1_000 },
  });
  return { service, calls, advance: (ms: number) => (now += ms) };
}

describe("files service", () => {
  it("merges quick-open hits across cloned repos and skips repos not cloned", async () => {
    const { service, calls } = harness({ "/work/atlas": ["src/main.ts"], "/work/beacon": ["main.ts", "docs/domain.md"] });
    const hits = await service.quickOpen("w1", "main", 10);
    expect(hits.ok && hits.value.map((hit) => `${hit.repoId}:${hit.path}`)).toEqual(["beacon:main.ts", "atlas:src/main.ts", "beacon:docs/domain.md"]);
    expect(calls.sort()).toEqual(["/work/atlas", "/work/beacon"]);
  });

  it("answers from the old listing and lists again in the background once it is old", async () => {
    const listings = { "/work/atlas": ["a.ts"], "/work/beacon": [] as string[] };
    const { service, calls, advance } = harness(listings);
    await service.quickOpen("w1", "", 10);
    expect(calls).toHaveLength(2);
    listings["/work/atlas"] = ["a.ts", "fresh.ts"];
    await service.quickOpen("w1", "fresh", 10);
    expect(calls).toHaveLength(2);

    advance(1_001);
    const stale = await service.quickOpen("w1", "fresh", 10);
    expect(stale.ok && stale.value).toEqual([]);
    expect(calls).toHaveLength(4);
    const fresh = await service.quickOpen("w1", "fresh", 10);
    expect(fresh.ok && fresh.value.map((hit) => hit.path)).toEqual(["fresh.ts"]);
  });

  it("lists the tree from a fresh listing", async () => {
    const listings = { "/work/atlas": ["src/a.ts"] };
    const { service, advance } = harness(listings);
    await service.list("atlas", "");
    listings["/work/atlas"] = ["src/a.ts", "src/b.ts"];
    advance(1_001);
    const listed = await service.list("atlas", "src");
    expect(listed.ok && listed.value.map((entry) => entry.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("refuses a repo that is not cloned and an unknown workspace", async () => {
    const { service } = harness({});
    expect(await service.list("later", "")).toEqual(err(filesError("files.not_cloned", "repo later is not cloned yet")));
    const missing = await service.quickOpen("w2", "a", 10);
    expect(!missing.ok && missing.error.code).toBe("files.workspace_not_found");
  });
});
