import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtures, lintArch } from "./run-lint-arch.ts";

describe("lint-arch engine import rules", () => {
  it("pass on the repository's engine packages", () => {
    expect(lintArch("--engine", join(import.meta.dirname, "..", "..", "packages"))).toEqual({ status: 0, stderr: "" });
  });

  it.each([
    ["core-imports-adapter", "core must not import @pica/adapters"],
    ["core-imports-node-io", 'core must not import the Node module "node:fs"'],
    ["adapter-imports-adapter", 'adapter "git" must not import adapter "github"'],
    ["relative-import-leaves-package", "leaves package core"],
  ])("reject the fixture %s", (fixture, message) => {
    const result = lintArch("--engine", join(fixtures, fixture, "packages"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
