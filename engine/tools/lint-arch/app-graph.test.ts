import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtures, lintArch } from "./run-lint-arch.ts";

const swiftTimeout = 60_000;

describe("lint-arch app package graph", () => {
  it("passes on the repository's app packages", { timeout: swiftTimeout }, () => {
    expect(lintArch("--app", join(import.meta.dirname, "..", "..", "..", "app", "Packages"))).toEqual({
      status: 0,
      stderr: "",
    });
  });

  it.each([
    ["feature-depends-on-feature", "feature Session must not depend on feature Sidebar"],
    ["feature-imports-feature", "feature Session must not import feature Sidebar"],
  ])("rejects the fixture %s", { timeout: swiftTimeout }, (fixture, message) => {
    const result = lintArch("--app", join(fixtures, fixture, "Packages"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
