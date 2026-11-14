import { describe, expect, it } from "vitest";
import { parseRepoMentions, repoRefs, type Repo, type RepoMention } from "../../src/index.ts";

function repo(owner: string, name: string): Repo {
  return {
    id: `${owner}-${name}`,
    remoteUrl: `git@github.com:${owner}/${name}.git`,
    localPath: `/repos/${owner}/${name}`,
    managed: true,
    defaultBranch: "main",
    cloneState: "ready",
  };
}

// `api` exists twice, so it is ambiguous on its own; `web` and `docs` are unique.
const refs = repoRefs([repo("acme", "web"), repo("acme", "api"), repo("other", "api"), repo("acme", "docs")]);

type Summary =
  | { kind: "resolved"; raw: string; repo: string; path: string; lines?: { start: number; end: number } }
  | { kind: "ambiguous"; raw: string; candidates: readonly string[] }
  | { kind: "missing"; raw: string; repoName: string }
  | { kind: "invalid_path"; raw: string; repo: string; path: string };

function summary(mention: RepoMention): Summary {
  switch (mention.kind) {
    case "resolved":
      return { kind: "resolved", raw: mention.raw, repo: mention.repo.qualifiedName, path: mention.path, ...(mention.lines === undefined ? {} : { lines: mention.lines }) };
    case "ambiguous":
      return { kind: "ambiguous", raw: mention.raw, candidates: mention.candidates };
    case "missing":
      return { kind: "missing", raw: mention.raw, repoName: mention.repoName };
    case "invalid_path":
      return { kind: "invalid_path", raw: mention.raw, repo: mention.repo.qualifiedName, path: mention.path };
  }
}

const cases: readonly (readonly [string, string, readonly Summary[]])[] = [
  ["a unique short name", "see @web:src/app.ts", [{ kind: "resolved", raw: "@web:src/app.ts", repo: "acme/web", path: "src/app.ts" }]],
  ["the repo root", "@docs: overview", [{ kind: "resolved", raw: "@docs:", repo: "acme/docs", path: "" }]],
  ["a qualified name", "@other/api:main.go", [{ kind: "resolved", raw: "@other/api:main.go", repo: "other/api", path: "main.go" }]],
  ["case-insensitive names", "@WEB:README.md", [{ kind: "resolved", raw: "@WEB:README.md", repo: "acme/web", path: "README.md" }]],
  ["a single line", "@web:a.ts:12", [{ kind: "resolved", raw: "@web:a.ts:12", repo: "acme/web", path: "a.ts", lines: { start: 12, end: 12 } }]],
  ["a line range", "@web:a.ts:20-12", [{ kind: "resolved", raw: "@web:a.ts:20-12", repo: "acme/web", path: "a.ts", lines: { start: 12, end: 20 } }]],
  ["a normalized path", "@web:./src//x/../app.ts", [{ kind: "resolved", raw: "@web:./src//x/../app.ts", repo: "acme/web", path: "src/app.ts" }]],
  ["trailing punctuation", "Look at (@web:src/app.ts).", [{ kind: "resolved", raw: "@web:src/app.ts", repo: "acme/web", path: "src/app.ts" }]],
  ["an ambiguous short name", "@api:main.go", [{ kind: "ambiguous", raw: "@api:main.go", candidates: ["acme/api", "other/api"] }]],
  ["a missing repo", "@mobile:App.swift", [{ kind: "missing", raw: "@mobile:App.swift", repoName: "mobile" }]],
  ["a missing qualified repo", "@acme/mobile:x", [{ kind: "missing", raw: "@acme/mobile:x", repoName: "acme/mobile" }]],
  ["a qualified name with the wrong owner", "@nobody/web:x", [{ kind: "missing", raw: "@nobody/web:x", repoName: "nobody/web" }]],
  ["a path climbing out", "@web:../api/secret", [{ kind: "invalid_path", raw: "@web:../api/secret", repo: "acme/web", path: "../api/secret" }]],
  ["an absolute path", "@web:/etc/passwd", [{ kind: "invalid_path", raw: "@web:/etc/passwd", repo: "acme/web", path: "/etc/passwd" }]],
  ["an e-mail address", "mail dev@web:8080 now", []],
  ["a mention without a colon", "ask @web about it", []],
  [
    "several mentions in order",
    "@web:a.ts and @api:b.go, then @docs:c.md",
    [
      { kind: "resolved", raw: "@web:a.ts", repo: "acme/web", path: "a.ts" },
      { kind: "ambiguous", raw: "@api:b.go", candidates: ["acme/api", "other/api"] },
      { kind: "resolved", raw: "@docs:c.md", repo: "acme/docs", path: "c.md" },
    ],
  ],
];

describe("parseRepoMentions (R-08)", () => {
  it.each(cases)("%s", (_label, text, expected) => {
    expect(parseRepoMentions(text, refs).map(summary)).toEqual(expected);
  });

  it("reports where each mention sits in the text", () => {
    const text = "Compare (@web:a.ts) with @docs:b.md.";
    for (const mention of parseRepoMentions(text, refs)) {
      expect(text.slice(mention.start, mention.end)).toBe(mention.raw);
    }
  });

  it("finds nothing when the workspace has no repos, and calls every mention missing", () => {
    expect(parseRepoMentions("@web:a.ts", []).map((mention) => mention.kind)).toEqual(["missing"]);
  });
});

describe("repoRefs (R-08)", () => {
  it("names repos by short name unless it is shared, sorted by that name", () => {
    expect(refs.map((ref) => ref.mention)).toEqual(["acme/api", "docs", "other/api", "web"]);
  });
});
