import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repoEngineTools } from "@pica/core";
import { makeRepoToolsFixture, type RepoToolsFixture } from "./fixture.ts";

let fixture: RepoToolsFixture;
beforeAll(() => {
  fixture = makeRepoToolsFixture();
});
afterAll(() => {
  fixture.cleanup();
});

describe("repo_read containment (R-08)", () => {
  it.each([
    ["a sibling repo through ..", "api", "../web/index.ts"],
    ["a path climbing above the root", "api", "src/../../outside/secret.txt"],
    ["an absolute path", "api", "/etc/passwd"],
    ["an absolute path into another repo", "api", "__ROOT__/web/index.ts"],
    ["a home-relative path", "api", "~/.ssh/id_rsa"],
    ["a symlinked file leading out", "api", "escape.txt"],
    ["a file under a symlinked directory leading out", "api", "linkdir/secret.txt"],
  ])("refuses %s", async (_label, repo, path) => {
    const result = await fixture.tools().read({ repo, path: path.replace("__ROOT__", fixture.root) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("repo_tools.outside_workspace");
  });

  it("refuses a repo that is not in the workspace", async () => {
    const [web] = fixture.repos;
    if (web === undefined) throw new Error("fixture");
    const result = await fixture.tools([web]).read({ repo: "api", path: "src/a.ts" });
    expect(result.ok ? undefined : result.error.code).toBe("repo_tools.repo_not_found");
  });

  it("refuses directories and binary files with not_a_file", async () => {
    const tools = fixture.tools();
    const directory = await tools.read({ repo: "api", path: "src" });
    const binary = await tools.read({ repo: "api", path: "logo.bin" });
    expect(directory.ok ? undefined : directory.error.code).toBe("repo_tools.not_a_file");
    expect(binary.ok ? undefined : binary.error.code).toBe("repo_tools.not_a_file");
  });

  it("reads a file, a line range, and a symlink that stays inside the repo", async () => {
    const tools = fixture.tools();
    const whole = await tools.read({ repo: "api", path: "./src/b.ts" });
    const range = await tools.read({ repo: "acme/api", path: "src/b.ts", startLine: 2, endLine: 2 });
    const alias = await tools.read({ repo: "api", path: "alias.ts" });
    expect(whole.ok && whole.value).toMatchObject({ repo: "api", path: "src/b.ts", startLine: 1, endLine: 5, totalLines: 5, truncated: false });
    expect(range.ok && range.value).toMatchObject({ text: "export const needle = 2;", truncated: true });
    expect(alias.ok && alias.value.text).toBe("needle();");
  });

  it("returns the refusal to the model as a failed tool call", async () => {
    const tool = repoEngineTools(fixture.tools()).find((candidate) => candidate.name === "repo_read");
    const output = await tool?.invoke({ repo: "api", path: "../web/index.ts" });
    expect(output).toEqual({ ok: false, text: 'repo_tools.outside_workspace: "api:../web/index.ts" is outside the workspace repos' });
  });

  it("lists repos and directory entries without following links out", async () => {
    const tools = fixture.tools();
    const repos = await tools.list({});
    const entries = await tools.list({ repo: "api", path: "src" });
    const escape = await tools.list({ repo: "api", path: "linkdir" });
    expect(repos.ok && repos.value.kind === "repos" && repos.value.repos.map((repo) => repo.mention)).toEqual(["api", "docs", "web"]);
    expect(entries.ok && entries.value.kind === "entries" && entries.value.entries).toEqual(["a.ts", "b.ts"]);
    expect(escape.ok ? undefined : escape.error.code).toBe("repo_tools.outside_workspace");
  });
});
