import { describe, expect, it } from "vitest";
import { createPathRanker, fuzzyScore } from "../../src/index.ts";

// A-09 (docs/files.md): each row ranks `paths` for `query`; `expected` is the order quick open shows.
const rankingTable: readonly { readonly name: string; readonly query: string; readonly paths: readonly string[]; readonly expected: readonly string[] }[] = [
  {
    name: "an exact file name beats a longer one that starts with it",
    query: "main.ts",
    paths: ["src/main.tsx", "src/main.ts", "tools/domain.ts"],
    expected: ["src/main.ts", "src/main.tsx", "tools/domain.ts"],
  },
  {
    name: "a match in the file name beats one spread over directories",
    query: "button",
    paths: ["b/u/t/t/o/n.ts", "src/ui/button.swift", "docs/about-nothing.md"],
    expected: ["src/ui/button.swift", "b/u/t/t/o/n.ts"],
  },
  {
    name: "word starts beat letters inside words",
    query: "sc",
    paths: ["lib/misc.ts", "src/session-controller.ts", "src/SessionColumn.swift"],
    expected: ["src/SessionColumn.swift", "src/session-controller.ts", "lib/misc.ts"],
  },
  {
    name: "adjacent letters beat scattered ones, and the file name beats a directory",
    query: "store",
    paths: ["s/t/o/r/e.txt", "core/src/store/index.ts", "sto-re.md"],
    expected: ["sto-re.md", "core/src/store/index.ts", "s/t/o/r/e.txt"],
  },
  {
    name: "case and spaces are ignored",
    query: "Nav Store",
    paths: ["app/NavigationStore.swift", "app/navstore.md", "app/Other.swift"],
    expected: ["app/navstore.md", "app/NavigationStore.swift"],
  },
  {
    name: "a path segment typed with its slash narrows to that directory",
    query: "core/index",
    paths: ["core/src/index.ts", "server/src/index.ts", "core/index.ts"],
    expected: ["core/index.ts", "core/src/index.ts"],
  },
  {
    name: "equal scores fall back to the shorter path, then code-point order",
    query: "readme",
    paths: ["b/README.md", "a/README.md", "README.md"],
    expected: ["README.md", "a/README.md", "b/README.md"],
  },
  {
    name: "letters out of order do not match",
    query: "tsx",
    paths: ["xts.md", "s/t/x"],
    expected: [],
  },
];

describe("quick-open ranking", () => {
  it.each(rankingTable)("$name", ({ query, paths, expected }) => {
    const ranker = createPathRanker(paths);
    expect(ranker.rank(query, 10).map((hit) => hit.path)).toEqual(expected);
  });

  it("matches nothing for an empty query", () => {
    expect(createPathRanker(["a.ts"]).rank("  ", 10)).toEqual([]);
    expect(fuzzyScore("", "a.ts")).toBeNull();
  });

  it("keeps only the best `limit` paths", () => {
    const paths = Array.from({ length: 50 }, (_, index) => `src/file-${String(index).padStart(2, "0")}.ts`);
    expect(createPathRanker(paths).rank("file", 3).map((hit) => hit.path)).toEqual([
      "src/file-00.ts",
      "src/file-01.ts",
      "src/file-02.ts",
    ]);
  });

  it("ranks the same after narrowing as from scratch", () => {
    const paths = ["src/main.ts", "src/manifest.json", "docs/mantra.md", "lib/m.ts", "src/domain/main.swift"];
    const typed = createPathRanker(paths);
    for (const query of ["m", "ma", "man", "mani"]) typed.rank(query, 10);
    expect(typed.rank("manif", 10)).toEqual(createPathRanker(paths).rank("manif", 10));
    // A query that does not extend the last one searches every path again.
    expect(typed.rank("main", 10)).toEqual(createPathRanker(paths).rank("main", 10));
  });

  it("scores a consecutive run above the same letters with a gap", () => {
    expect(fuzzyScore("ab", "xxab")).toBeGreaterThan(fuzzyScore("ab", "xaxb") ?? Infinity);
  });
});
