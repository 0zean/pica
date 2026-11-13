import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsoncConfigLoader, repoConfigPath, userConfigPath } from "../../src/index.ts";
import { useTempDir, writeFile } from "./helpers.ts";

const tempDir = useTempDir();

describe("JsoncConfigLoader", () => {
  it("layers user, workspace, repo and managed sources", () => {
    const root = tempDir();
    const user = writeFile(
      userConfigPath(root),
      `{
        "$schema": "../config.schema.json",
        // comments and trailing commas are allowed
        "routing": { "profile": "strict", "tiers": { "worker": "small" }, },
        "budget": { "sessionCredits": 100 },
      }`,
    );
    const repo = writeFile(repoConfigPath(join(root, "repo")), `{ "routing": { "profile": "off" } }`);
    const managed = writeFile(join(root, "managed.jsonc"), `{ "budget": { "sessionCredits": 50 } }`);
    const result = new JsoncConfigLoader([
      { layer: "managed", file: managed },
      { layer: "repo", file: repo },
      { layer: "workspace", label: "workspace:team", value: { budget: { sessionCredits: 200 }, permissions: { mode: "auto" } } },
      { layer: "user", file: user },
    ]).load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.config.routing.profile).toBe("off");
      expect(result.value.config.routing.tiers.worker).toBe("small");
      expect(result.value.config.permissions.mode).toBe("auto");
      expect(result.value.values.get("budget.sessionCredits")).toMatchObject({ value: 50, layer: "managed", locked: true });
    }
  });

  it("treats missing and empty files as absent layers", () => {
    const root = tempDir();
    const empty = writeFile(join(root, "empty.jsonc"), "");
    const result = new JsoncConfigLoader([
      { layer: "user", file: join(root, "missing", "config.jsonc") },
      { layer: "repo", file: empty },
    ]).load();
    expect(result.ok && result.value.config.routing.profile).toBe("balanced");
  });

  it("reports a file that cannot be read", () => {
    const root = tempDir();
    const result = new JsoncConfigLoader([{ layer: "user", file: root }]).load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: "config.read_failed", file: root });
    }
  });
});
