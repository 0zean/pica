import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { McpSourceFormat } from "@pica/core";
import { JsoncMcpRegistryLoader } from "../../src/index.ts";

// Each case directory holds one source file under its real name and a reviewed expected.json.
// PICA_UPDATE_GOLDEN=1 rewrites expected.json; review the diff before committing.
const importDir = join(import.meta.dirname, "..", "..", "..", "..", "..", "fixtures", "mcp", "import");
const formats: readonly McpSourceFormat[] = ["vscode", "mcp-json", "copilot-cli", "pica"];
const root = "/work/repo";
const home = "/Users/dev";

const cases = formats.flatMap((format) =>
  readdirSync(join(importDir, format))
    .sort()
    .map((name) => ({ format, name, dir: join(importDir, format, name) })),
);

function sourceFile(dir: string): string {
  const files = readdirSync(dir).filter((file) => file !== "expected.json");
  expect(files, `${dir} must hold exactly one source file`).toHaveLength(1);
  return join(dir, files[0] ?? "");
}

function importCase(format: McpSourceFormat, dir: string): unknown {
  const file = sourceFile(dir);
  const result = new JsoncMcpRegistryLoader([{ scope: format === "copilot-cli" ? "global" : "repo", format, file, root, home }]).load();
  if (!result.ok) {
    return { error: { code: result.error.code, issues: result.error.issues } };
  }
  return {
    servers: result.value.servers.map((server) => server.definition),
    notes: result.value.notes.map(({ keyPath, message }) => ({ keyPath, message })),
  };
}

describe("MCP import goldens", () => {
  it("covers every source format", () => {
    expect(new Set(cases.map((entry) => entry.format))).toEqual(new Set(formats));
  });

  it.each(cases)("$format/$name matches expected.json", ({ format, dir }) => {
    const actual = importCase(format, dir);
    const expectedFile = join(dir, "expected.json");
    if (process.env["PICA_UPDATE_GOLDEN"] === "1") {
      writeFileSync(expectedFile, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(existsSync(expectedFile), `${expectedFile} is missing`).toBe(true);
    expect(actual).toEqual(JSON.parse(readFileSync(expectedFile, "utf8")) as unknown);
  });
});
