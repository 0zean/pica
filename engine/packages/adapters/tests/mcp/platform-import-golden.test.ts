import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMcpImportService, ok } from "@pica/core";
import type { McpImportFilePlatform, McpImportFiles } from "@pica/core";
import { parseConfigFile } from "../../src/index.ts";

// M-07 goldens: one directory per platform, one case per subdirectory holding the platform's file
// under its real name and a reviewed expected.json (the `mcp.importCandidates` source for it).
// A case named `project` is a project file in /Users/dev/work/app. PICA_UPDATE_GOLDEN=1 rewrites
// expected.json; review the diff before committing.
const platformsDir = join(import.meta.dirname, "..", "..", "..", "..", "..", "fixtures", "mcp", "platforms");
const platforms: readonly McpImportFilePlatform[] = [
  "claude-desktop",
  "claude-code",
  "cursor",
  "windsurf",
  "vscode",
  "gemini-cli",
  "copilot-cli",
  "mcp-json",
];
const home = "/Users/dev";

const cases = platforms.flatMap((platform) =>
  readdirSync(join(platformsDir, platform))
    .sort()
    .map((name) => ({ platform, name, dir: join(platformsDir, platform, name) })),
);

function candidatesFor(platform: McpImportFilePlatform, name: string, dir: string): unknown {
  const files = readdirSync(dir).filter((file) => file !== "expected.json");
  expect(files, `${dir} must hold exactly one platform file`).toHaveLength(1);
  const fileName = files[0] ?? "";
  const parsed = parseConfigFile(fileName, readFileSync(join(dir, fileName), "utf8"));
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  const port: McpImportFiles = {
    discover: () => [
      {
        platform,
        file: join(home, "fixtures", platform, name, fileName),
        value: parsed.value.value,
        home,
        ...(name === "project" ? { root: join(home, "work", "app") } : {}),
      },
    ],
    readTarget: () => ok({ file: "/unused", value: undefined }),
    writeTarget: () => ok({ file: "/unused" }),
  };
  const result = createMcpImportService({ files: port, home }).candidates({});
  if (!result.ok) {
    return { error: result.error };
  }
  return result.value[0];
}

describe("M-07 platform import goldens", () => {
  it("covers every platform format", () => {
    expect(new Set(cases.map((entry) => entry.platform))).toEqual(new Set(platforms));
  });

  it.each(cases)("$platform/$name matches expected.json", ({ platform, name, dir }) => {
    const actual = candidatesFor(platform, name, dir);
    const expectedFile = join(dir, "expected.json");
    if (process.env["PICA_UPDATE_GOLDEN"] === "1") {
      writeFileSync(expectedFile, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(existsSync(expectedFile), `${expectedFile} is missing`).toBe(true);
    expect(actual).toEqual(JSON.parse(readFileSync(expectedFile, "utf8")) as unknown);
  });

  it("never puts an inline secret's value in a candidate", () => {
    const listed = JSON.stringify(cases.map(({ platform, name, dir }) => candidatesFor(platform, name, dir)));
    for (const value of ["test-pat-value-not-real", "hunter2-test", "test-bearer-not-real"]) {
      expect(listed).not.toContain(value);
    }
  });
});
