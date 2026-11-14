import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatHit, repoEngineTools, type Repo } from "@pica/core";
import { makeRepoToolsFixture, type RepoToolsFixture } from "./fixture.ts";

const allHits = [
  "api:notes.md:1: untracked needle",
  "api:src/a.ts:1: needle();",
  "api:src/b.ts:2: export const needle = 2;",
  "api:src/b.ts:5: // Needle again",
  "docs:guide.md:2: A needle.",
  "web:index.ts:1: import { needle } from 'api';",
  "web:z/deep.ts:1: NEEDLE",
];

let fixture: RepoToolsFixture;
beforeAll(() => {
  fixture = makeRepoToolsFixture();
});
afterAll(() => {
  fixture.cleanup();
});

async function search(request: Parameters<ReturnType<RepoToolsFixture["tools"]>["search"]>[0], repos?: readonly Repo[]) {
  const result = await fixture.tools(repos).search(request);
  if (!result.ok) throw new Error(result.error.message);
  return { ...result.value, lines: result.value.hits.map(formatHit) };
}

describe("repo_search on a three-repo fixture (R-08)", () => {
  it("returns repo:path:line hits ordered by repo, path and line, skipping ignored, binary and symlinked files", async () => {
    const result = await search({ query: "needle" });
    expect(result.lines).toEqual(allHits);
    expect(result.truncated).toBe(false);
  });

  it("stops at the result cap with the same leading hits every time", async () => {
    const first = await search({ query: "needle", limit: 3 });
    const second = await search({ query: "needle", limit: 3 });
    expect(first.lines).toEqual(allHits.slice(0, 3));
    expect(first.truncated).toBe(true);
    expect(second.lines).toEqual(first.lines);
  });

  it("does not report truncation when the hits exactly fill the cap", async () => {
    const result = await search({ query: "needle", limit: allHits.length });
    expect(result.lines).toEqual(allHits);
    expect(result.truncated).toBe(false);
  });

  it("does not depend on the order the workspace lists its repos in", async () => {
    const result = await search({ query: "needle" }, [...fixture.repos].reverse());
    expect(result.lines).toEqual(allHits);
  });

  it("narrows by repo, path glob and case", async () => {
    expect((await search({ query: "needle", repo: "web" })).lines).toEqual(allHits.slice(5));
    expect((await search({ query: "needle", path: "src/**" })).lines).toEqual(allHits.slice(1, 4));
    expect((await search({ query: "Needle", caseSensitive: true })).lines).toEqual(["api:src/b.ts:5: // Needle again"]);
  });

  it("reports repos that are not cloned instead of searching them", async () => {
    const [web, api, docs] = fixture.repos;
    if (web === undefined || api === undefined || docs === undefined) throw new Error("fixture");
    const absent: Repo = { ...docs, localPath: null, cloneState: "absent" };
    const result = await search({ query: "needle" }, [web, api, absent]);
    expect(result.lines).toEqual([...allHits.slice(0, 4), ...allHits.slice(5)]);
    expect(result.skipped).toEqual(["docs"]);
  });

  it("is exposed to the model as repo_search with the same lines", async () => {
    const tool = repoEngineTools(fixture.tools()).find((candidate) => candidate.name === "repo_search");
    const output = await tool?.invoke({ query: "needle", limit: 2 });
    expect(output).toEqual({ ok: true, text: [...allHits.slice(0, 2), "… more matches; narrow with repo or path"].join("\n") });
  });
});
