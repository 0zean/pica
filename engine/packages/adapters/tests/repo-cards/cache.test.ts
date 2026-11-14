import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRepoCardService, type RepoCardSource } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileRepoCardCache, createGitRepoCardSource } from "../../src/index.ts";
import { git, gitEnv, makeFixtureRoot, value } from "./helpers.ts";

let root: string;
let repoPath: string;
let cacheDir: string;
let listCalls: number;

function countingSource(): RepoCardSource {
  const source = createGitRepoCardSource({ env: gitEnv });
  return {
    ...source,
    listFiles(repo, commit) {
      listCalls += 1;
      return source.listFiles(repo, commit);
    },
  };
}

function service(maxBytes?: number) {
  return createRepoCardService({
    source: countingSource(),
    cache: createFileRepoCardCache(cacheDir),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
}

const repo = () => ({ id: "repo-node", name: "acme/node", path: repoPath });

beforeEach(() => {
  root = makeFixtureRoot();
  repoPath = join(root, "repos/node");
  cacheDir = join(root, "cache");
  listCalls = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("repo card cache", () => {
  it("reuses the cached card on the same commit, even from a new service instance", async () => {
    const first = value(await service().card(repo()));
    const second = value(await service().card(repo()));
    expect(first.fromCache).toBe(false);
    expect(second).toEqual({ text: first.text, commit: first.commit, fromCache: true });
    expect(listCalls).toBe(1);
  });

  it("ignores working-tree changes that are not committed", async () => {
    const first = value(await service().card(repo()));
    writeFileSync(join(repoPath, "go.mod"), "module example.com/x\n");
    const second = value(await service().card(repo()));
    expect(second.fromCache).toBe(true);
    expect(second.text).toBe(first.text);
  });

  it("rebuilds the card when HEAD moves to a new commit", async () => {
    const first = value(await service().card(repo()));
    writeFileSync(join(repoPath, "go.mod"), "module example.com/x\n");
    git(repoPath, "add", "go.mod");
    git(repoPath, "commit", "--quiet", "-m", "Add go module");
    const second = value(await service().card(repo()));
    expect(second.fromCache).toBe(false);
    expect(second.commit).not.toBe(first.commit);
    expect(second.text).toContain("go test ./...");
    expect(listCalls).toBe(2);
    expect(value(await service().card(repo())).fromCache).toBe(true);
    expect(readdirSync(cacheDir).filter((file) => file.endsWith(".json"))).toHaveLength(1);
  });

  it("rebuilds when the size cap changes", async () => {
    value(await service().card(repo()));
    const smaller = value(await service(200).card(repo()));
    expect(smaller.fromCache).toBe(false);
    expect(Buffer.byteLength(smaller.text)).toBeLessThanOrEqual(200);
  });

  it("treats a corrupt cache entry as a miss and replaces it", async () => {
    value(await service().card(repo()));
    for (const file of readdirSync(cacheDir)) writeFileSync(join(cacheDir, file), "{not json");
    expect(value(await service().card(repo())).fromCache).toBe(false);
    expect(value(await service().card(repo())).fromCache).toBe(true);
  });

  it("still returns the card when the cache cannot be written", async () => {
    writeFileSync(cacheDir, "a file where the cache directory should be");
    const card = value(await service().card(repo()));
    expect(card.fromCache).toBe(false);
    expect(card.text).toContain("repo: acme/node");
    expect(card.cacheError?.code).toMatch(/^fs\./);
  });

  it("reports a repository with no commits", async () => {
    const empty = join(root, "empty");
    git(root, "init", "--quiet", empty);
    const result = await service().card({ id: "empty", name: "acme/empty", path: empty });
    expect(result.ok ? undefined : result.error.code).toBe("git.unknown_revision");
  });
});
