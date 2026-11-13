import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDiff, parseStatus } from "../../src/index.ts";

// Raw inputs are real git output captured by golden/capture.sh; each has a reviewed .json beside it.
const goldenDir = join(import.meta.dirname, "golden");
const parsers = { status: parseStatus, diff: parseDiff } as const;

const cases = readdirSync(goldenDir)
  .filter((file) => file.endsWith(".status") || file.endsWith(".diff"))
  .sort();

describe("git output goldens", () => {
  it("covers renames, binary files, submodules, conflicts, and quoted paths", () => {
    const all = cases.map((file) => readFileSync(join(goldenDir, file), "utf8")).join("\n");
    expect(all).toContain("\u00002 R");
    expect(all).toContain("rename from ");
    expect(all).toContain("Binary files ");
    expect(all).toContain(" 160000");
    expect(all).toContain("\u0000u UU ");
    expect(all).toContain("diff --cc ");
    expect(all).toContain('"b/tab\\there');
  });

  it.each(cases)("%s parses to its golden", (file) => {
    const kind = file.endsWith(".status") ? "status" : "diff";
    const expectedFile = join(goldenDir, `${file}.json`);
    expect(existsSync(expectedFile), `${file}.json is missing`).toBe(true);
    const parsed = parsers[kind](readFileSync(join(goldenDir, file), "utf8"));
    expect(parsed).toEqual({ ok: true, value: JSON.parse(readFileSync(expectedFile, "utf8")) as unknown });
  });
});
