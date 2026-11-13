import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packagesDir = join(import.meta.dirname, "..", "packages");
const expectedPackages = ["adapters", "cli", "core", "evals", "protocol", "server", "testkit"];

describe("engine workspace", () => {
  it("contains exactly the packages in PLAN.md §4.2", () => {
    expect(readdirSync(packagesDir).sort()).toEqual(expectedPackages);
  });

  it.each(expectedPackages)("names %s after its directory and gives it an entry point", (dir) => {
    const manifest = JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8")) as {
      name: string;
    };
    expect(manifest.name).toBe(`@pica/${dir}`);
    expect(existsSync(join(packagesDir, dir, "src", "index.ts"))).toBe(true);
  });
});
