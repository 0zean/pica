import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");

interface Check {
  check: string;
  run?: string;
  live?: boolean;
  manual?: boolean;
}

function readUnits(): Record<string, Check[]> {
  return JSON.parse(readFileSync(join(repoRoot, "tools", "verify", "units.json"), "utf8")) as Record<
    string,
    Check[]
  >;
}

function unitIndexIds(): string[] {
  const plan = readFileSync(join(repoRoot, "PLAN.md"), "utf8");
  const start = plan.indexOf("## 12. Unit index");
  const end = plan.indexOf("\n## ", start + 1);
  const section = plan.slice(start, end);
  return [...section.matchAll(/^\| ([A-Z]-\d{2}) \|/gm)].map((match) => match[1] ?? "");
}

describe("units.json", () => {
  it("has an entry for every unit in PLAN.md §12 and nothing else", () => {
    const ids = unitIndexIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(Object.keys(readUnits()).sort()).toEqual([...ids].sort());
  });

  it("describes each check and how it runs", () => {
    for (const [unit, checks] of Object.entries(readUnits())) {
      expect(checks.length, unit).toBeGreaterThan(0);
      for (const check of checks) {
        expect(Object.keys(check).every((key) => ["check", "run", "live", "manual"].includes(key)), unit).toBe(true);
        expect(check.check, unit).not.toBe("");
        expect(check.manual === true && check.run !== undefined, `${unit}: manual checks have no command`).toBe(false);
      }
    }
  });
});
