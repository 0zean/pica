import { renameSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConfigResult, ResolvedConfig } from "@pica/core";
import { JsoncConfigLoader } from "../../src/index.ts";
import { useTempDir, writeFile } from "./helpers.ts";

const tempDir = useTempDir();

// Starts watching, runs `change`, and resolves with the first reload that `matches`.
function changeAndWait(
  loader: JsoncConfigLoader,
  change: () => void,
  matches: (result: ConfigResult<ResolvedConfig>) => boolean,
): Promise<ConfigResult<ResolvedConfig>> {
  return new Promise((resolve) => {
    const watcher = loader.watch((result) => {
      if (matches(result)) {
        watcher.close();
        resolve(result);
      }
    });
    change();
  });
}

describe("config watching", () => {
  it("reloads when a watched file changes", async () => {
    const file = writeFile(join(tempDir(), "config.jsonc"), `{ "routing": { "profile": "strict" } }`);
    const loader = new JsoncConfigLoader([{ layer: "user", file }]);
    const result = await changeAndWait(
      loader,
      () => writeFile(file, `{ "routing": { "profile": "off" } }`),
      (reloaded) => reloaded.ok && reloaded.value.config.routing.profile === "off",
    );
    expect(result.ok && result.value.values.get("routing.profile")?.layer).toBe("user");
  });

  it("reloads after an editor-style save that renames a new file over the old one", async () => {
    const directory = tempDir();
    const file = writeFile(join(directory, "config.jsonc"), `{}`);
    const loader = new JsoncConfigLoader([{ layer: "user", file }]);
    const result = await changeAndWait(
      loader,
      () => {
        renameSync(writeFile(join(directory, "config.jsonc.tmp"), `{ "permissions": { "mode": "auto" } }`), file);
      },
      (reloaded) => reloaded.ok && reloaded.value.config.permissions.mode === "auto",
    );
    expect(result.ok).toBe(true);

    const again = await changeAndWait(
      loader,
      () => writeFile(file, `{ "permissions": { "mode": "ask" } }`),
      (reloaded) => reloaded.ok && reloaded.value.config.permissions.mode === "ask",
    );
    expect(again.ok).toBe(true);
  });

  it("reports an edit that makes the file invalid", async () => {
    const file = writeFile(join(tempDir(), "config.jsonc"), `{ "budget": { "sessionCredits": 7 } }`);
    const loader = new JsoncConfigLoader([{ layer: "repo", file }]);
    const broken = await changeAndWait(
      loader,
      () => writeFile(file, `{ "budget": { "sessionCredits": "seven" } }`),
      (reloaded) => !reloaded.ok,
    );
    expect(!broken.ok && broken.error).toMatchObject({ file, issues: [{ keyPath: "budget.sessionCredits" }] });
  });
});
