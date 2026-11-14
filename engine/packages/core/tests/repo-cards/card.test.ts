import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildRepoCard, renderRepoCard, utf8Bytes, type RepoSnapshot } from "../../src/index.ts";

const commit = "0123456789abcdef0123456789abcdef01234567";

function snapshot(paths: readonly string[], files: Record<string, string> = {}): RepoSnapshot {
  return { name: "acme/repo", commit, paths, files: new Map(Object.entries(files)) };
}

const segment = fc.oneof(
  fc.constantFrom("src", "cmd", "Sources", "packages", "vendor", "main", "index", "lib", "tests"),
  fc.string({ minLength: 1, maxLength: 12 }).filter((text) => !text.includes("/")),
);
const fileName = fc.oneof(
  fc.constantFrom("package.json", "go.mod", "Makefile", "Package.swift", "pyproject.toml", "CODEOWNERS", "main.go"),
  fc.tuple(segment, fc.constantFrom("ts", "py", "go", "swift", "rs", "java", "c", "md")).map(
    ([stem, extension]) => `${stem}.${extension}`,
  ),
);
const path = fc.tuple(fc.array(segment, { maxLength: 3 }), fileName).map(([dirs, name]) => [...dirs, name].join("/"));
const anyText = fc.string({ maxLength: 400, unit: "binary" });
const snapshots = fc
  .record({
    name: fc.string({ maxLength: 80, unit: "binary" }),
    paths: fc.array(path, { maxLength: 200 }),
    files: fc.record(
      {
        "package.json": anyText,
        Makefile: anyText,
        "pyproject.toml": anyText,
        "Package.swift": anyText,
        CODEOWNERS: anyText,
      },
      { requiredKeys: [] },
    ),
  })
  .map(({ name, paths, files }): RepoSnapshot => ({
    name,
    commit,
    paths,
    files: new Map(Object.entries(files)),
  }));

describe("buildRepoCard", () => {
  it("does not depend on path order", () => {
    fc.assert(
      fc.property(snapshots, (input) => {
        const reversed = { ...input, paths: [...input.paths].reverse() };
        expect(renderRepoCard(buildRepoCard(reversed))).toBe(renderRepoCard(buildRepoCard(input)));
      }),
    );
  });

  it("ignores vendored and build output when counting languages", () => {
    const card = buildRepoCard(snapshot(["src/a.ts", "node_modules/x/index.js", "vendor/y.go", "dist/a.js"]));
    expect(card.languages).toEqual([{ name: "TypeScript", files: 1 }]);
  });

  it("skips npm's placeholder test script", () => {
    const placeholder = JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } });
    expect(buildRepoCard(snapshot(["package.json"], { "package.json": placeholder })).test).toEqual([]);
  });

  it("uses only the first CODEOWNERS file in GitHub's lookup order", () => {
    const card = buildRepoCard(
      snapshot([".github/CODEOWNERS", "CODEOWNERS"], {
        CODEOWNERS: "* @root",
        ".github/CODEOWNERS": "* @github # comment",
      }),
    );
    expect(card.owners).toEqual([{ pattern: "*", owners: ["@github"] }]);
  });
});

describe("renderRepoCard", () => {
  it("never exceeds its byte cap", () => {
    fc.assert(
      fc.property(snapshots, fc.integer({ min: 0, max: 3000 }), (input, maxBytes) => {
        expect(utf8Bytes(renderRepoCard(buildRepoCard(input), maxBytes))).toBeLessThanOrEqual(maxBytes);
      }),
      { numRuns: 300 },
    );
  });

  it("keeps each card on its own lines whatever the file names contain", () => {
    const card = buildRepoCard(snapshot(["evil\nname/package.json", "src/index.ts"]));
    expect(renderRepoCard(card).split("\n").every((line) => /^[a-z ]+: /.test(line))).toBe(true);
  });

  it("drops trailing items with a count rather than cutting an item", () => {
    const paths = Array.from({ length: 30 }, (_, index) => `pkg${String(index).padStart(2, "0")}/package.json`);
    const text = renderRepoCard(buildRepoCard(snapshot(paths)));
    expect(text).toContain("pkg11/package.json (+18 more)");
  });
});
