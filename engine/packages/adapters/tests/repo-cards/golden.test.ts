import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRepoCardService } from "@pica/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFileRepoCardCache, createGitRepoCardSource } from "../../src/index.ts";
import { ecosystems, gitEnv, makeFixtureRoot, value } from "./helpers.ts";

// Set PICA_UPDATE_GOLDEN=1 to rewrite the goldens after a deliberate change, then review the diff.
const goldenDir = join(import.meta.dirname, "golden");
const update = process.env["PICA_UPDATE_GOLDEN"] === "1";

let root: string;

beforeAll(() => {
  root = makeFixtureRoot();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function service() {
  return createRepoCardService({
    source: createGitRepoCardSource({ env: gitEnv }),
    cache: createFileRepoCardCache(join(root, "cache")),
  });
}

describe("repo card goldens", () => {
  it.each(ecosystems)("%s matches its golden card", async (ecosystem) => {
    const repo = { id: ecosystem, name: `acme/${ecosystem}`, path: join(root, "repos", ecosystem) };
    const card = value(await service().card(repo));
    const goldenFile = join(goldenDir, `${ecosystem}.txt`);
    if (update) writeFileSync(goldenFile, `${card.text}\n`);
    expect(`${card.text}\n`).toBe(readFileSync(goldenFile, "utf8"));
  });

  it("joins workspace cards in name order, identically on every call", async () => {
    const repos = [...ecosystems].reverse().map((ecosystem) => ({
      id: ecosystem,
      name: `acme/${ecosystem}`,
      path: join(root, "repos", ecosystem),
    }));
    const first = value(await service().workspaceCards(repos));
    const second = value(await service().workspaceCards([...repos].reverse()));
    expect(second).toBe(first);
    const goldens = ecosystems.map((ecosystem) => readFileSync(join(goldenDir, `${ecosystem}.txt`), "utf8").trimEnd());
    expect(first).toBe(goldens.join("\n\n"));
  });
});
