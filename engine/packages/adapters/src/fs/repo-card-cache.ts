import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type CachedRepoCard, type RepoCardCache, type RepoCardCacheError } from "@pica/core";

// One file per repo holding its latest card; a card for a new commit replaces the old one.
// Cards are derived data, so the directory can be deleted at any time.
export function createFileRepoCardCache(directory: string): RepoCardCache {
  const fileFor = (repoId: string): string =>
    join(directory, `${createHash("sha256").update(repoId).digest("hex").slice(0, 32)}.json`);

  return {
    async get(repoId) {
      let raw: string;
      try {
        raw = await readFile(fileFor(repoId), "utf8");
      } catch (thrown) {
        return errorCode(thrown) === "ENOENT" ? ok(null) : err(cacheError(thrown));
      }
      return ok(parseEntry(raw));
    },

    async put(repoId, card) {
      const file = fileFor(repoId);
      const temporary = `${file}.${String(process.pid)}.tmp`;
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(temporary, JSON.stringify({ key: card.key, text: card.text }), "utf8");
        await rename(temporary, file);
        return ok(undefined);
      } catch (thrown) {
        return err(cacheError(thrown));
      }
    },
  };
}

// A corrupt entry is a cache miss; the next build overwrites it.
function parseEntry(raw: string): CachedRepoCard | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { key, text } = parsed as Record<string, unknown>;
    return typeof key === "string" && typeof text === "string" ? { key, text } : null;
  } catch {
    return null;
  }
}

function errorCode(thrown: unknown): string {
  return thrown instanceof Error && "code" in thrown ? String(thrown.code) : "unknown";
}

function cacheError(thrown: unknown): RepoCardCacheError {
  return {
    code: `fs.${errorCode(thrown)}`,
    message: thrown instanceof Error ? thrown.message : String(thrown),
  };
}
