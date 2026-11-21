import { describe, expect, it } from "vitest";
import { parseGitVersion } from "../../src/index.ts";

describe("parseGitVersion (A-15)", () => {
  it.each([
    ["git version 2.39.5 (Apple Git-154)\n", "2.39.5 (Apple Git-154)"],
    ["git version 2.47.1\n", "2.47.1"],
    ["", null],
    ["xcode-select: note: No developer tools were found, requesting install.\n", null],
    ["git version \n", null],
  ])("reads %j as %j", (stdout, version) => {
    expect(parseGitVersion(stdout)).toBe(version);
  });
});
