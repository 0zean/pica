import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsoncConfigLoader, repoConfigPath, userConfigPath } from "../../src/index.ts";
import { useTempDir, writeFile } from "./helpers.ts";

const tempDir = useTempDir();

function loadError(text: string) {
  const file = writeFile(repoConfigPath(tempDir()), text);
  const result = new JsoncConfigLoader([{ layer: "repo", file }]).load();
  if (result.ok) {
    throw new Error("expected the file to be rejected");
  }
  return { file, error: result.error };
}

describe("invalid config files", () => {
  it("name the file, line and key path of a value with the wrong type", () => {
    const { file, error } = loadError(`{
  // budgets
  "budget": {
    "sessionCredits": "lots",
  },
}
`);
    expect(error.code).toBe("config.invalid");
    expect(error.file).toBe(file);
    expect(error.issues).toEqual([expect.objectContaining({ keyPath: "budget.sessionCredits", line: 4, column: 5 })]);
    expect(error.message).toContain(`${file}:4:5: budget.sessionCredits:`);
  });

  it("name an unknown key by its full path", () => {
    const { file, error } = loadError(`{ "routing": { "delegation": { "read": { "minByte": 10 } } } }`);
    expect(error.message).toBe(`${file}:1:42: routing.delegation.read.minByte: unknown key`);
  });

  it("name a value outside its enum", () => {
    const { file, error } = loadError(`{\n  "permissions": { "mode": "sometimes" }\n}`);
    expect(error.issues[0]).toMatchObject({ keyPath: "permissions.mode", line: 2 });
    expect(error.message).toContain(file);
  });

  it("name the file and position of a syntax error", () => {
    const { file, error } = loadError(`{\n  "budget": { "sessionCredits": 5 \n  "permissions": {}\n}`);
    expect(error.code).toBe("config.parse_error");
    expect(error.message).toContain(`${file}:3:3:`);
  });

  it("report the failing layer when several are loaded", () => {
    const home = tempDir();
    const user = writeFile(userConfigPath(home), `{ "budget": { "sessionCredits": 5 } }`);
    const repo = writeFile(join(home, "repo", ".pica", "config.jsonc"), `{ "budget": { "sessionCredits": -1 } }`);
    const result = new JsoncConfigLoader([
      { layer: "user", file: user },
      { layer: "repo", file: repo },
    ]).load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.file).toBe(repo);
      expect(result.error.issues[0]?.keyPath).toBe("budget.sessionCredits");
    }
  });
});
