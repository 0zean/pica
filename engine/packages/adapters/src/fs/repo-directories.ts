import { rm, stat } from "node:fs/promises";
import { err, ok, type RepoRegistryDirectories } from "@pica/core";

export function createRepoDirectories(): RepoRegistryDirectories {
  return {
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },

    async removeTree(path) {
      try {
        await rm(path, { recursive: true, force: true });
        return ok(undefined);
      } catch (thrown) {
        const code = thrown instanceof Error && "code" in thrown ? String(thrown.code) : "unknown";
        return err({ code: `fs.${code}`, message: thrown instanceof Error ? thrown.message : String(thrown) });
      }
    },
  };
}
