import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { customizationError, err, ok } from "@pica/core";
import type { CustomizationError, CustomizationFile, CustomizationFiles, LocationLayout, Result } from "@pica/core";

// X-02: agent, skill and instruction files on disk (docs/agents.md).
export function createCustomizationFiles(): CustomizationFiles {
  return {
    list: (path, layout) => attempt(() => listLocation(path, layout)),
    exists: (path) => existsSync(path),
    write: (path, text) =>
      attempt(() => {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.${String(process.pid)}.tmp`;
        writeFileSync(temporary, text.endsWith("\n") ? text : `${text}\n`, "utf8");
        renameSync(temporary, path);
        return undefined;
      }),
    remove: (path, pruneFolder) =>
      attempt(() => {
        unlinkSync(path);
        if (pruneFolder && readdirSync(dirname(path)).length === 0) rmdirSync(dirname(path));
        return undefined;
      }),
  };
}

function listLocation(path: string, layout: LocationLayout): CustomizationFile[] {
  const paths = filePaths(path, layout);
  return paths.map((file) => ({ path: file, text: readFileSync(file, "utf8") }));
}

// A missing folder or file is an empty location, as in C-02's loader.
function filePaths(path: string, layout: LocationLayout): string[] {
  switch (layout) {
    case "single-file":
      return existsSync(path) ? [path] : [];
    case "agent-files":
      return names(path).filter((name) => name.endsWith(".md")).map((name) => join(path, name));
    case "instruction-files":
      return names(path).filter((name) => name.endsWith(".instructions.md")).map((name) => join(path, name));
    case "skill-folders":
      return names(path)
        .map((name) => join(path, name, "SKILL.md"))
        .filter((file) => existsSync(file));
  }
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch (thrown) {
    if (isMissing(thrown)) return [];
    throw thrown;
  }
}

function attempt<T>(body: () => T): Result<T, CustomizationError> {
  try {
    return ok(body());
  } catch (thrown) {
    return err(customizationError("customization.io_failed", thrown instanceof Error ? thrown.message : String(thrown)));
  }
}

function isMissing(thrown: unknown): boolean {
  return typeof thrown === "object" && thrown !== null && "code" in thrown && (thrown.code === "ENOENT" || thrown.code === "ENOTDIR");
}
