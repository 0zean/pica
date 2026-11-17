import { compareText } from "../repo-tools/refs.ts";
import { err, ok, type Result } from "../result.ts";
import { filesError, type FilesError } from "./errors.ts";
import type { FilesServiceDeps } from "./ports.ts";
import { createPathRanker, type PathRanker } from "./ranking.ts";

// One repo root's listing: its paths in code-point order, and the ranker over them.
export interface IndexedRepo {
  readonly paths: readonly string[];
  readonly ranker: PathRanker;
  readonly listedAt: number;
}

export interface FileIndex {
  // The listing, listed again first when it is older than the limit.
  fresh(root: string): Promise<Result<IndexedRepo, FilesError>>;
  // Whatever listing there is, at once; an old one is listed again in the background.
  current(root: string): Promise<Result<IndexedRepo, FilesError>>;
}

export function createFileIndex(deps: Pick<FilesServiceDeps, "files" | "now">, maxAgeMs: number): FileIndex {
  const listings = new Map<string, IndexedRepo>();
  const pending = new Map<string, Promise<Result<IndexedRepo, FilesError>>>();

  function list(root: string): Promise<Result<IndexedRepo, FilesError>> {
    const running = pending.get(root);
    if (running !== undefined) return running;
    const started = (async (): Promise<Result<IndexedRepo, FilesError>> => {
      const listed = await deps.files.listFiles(root);
      if (!listed.ok) return err(filesError("files.io_failed", listed.error.message));
      const paths = [...listed.value].sort(compareText);
      const listing = { paths, ranker: createPathRanker(paths), listedAt: deps.now() };
      listings.set(root, listing);
      return ok(listing);
    })().finally(() => pending.delete(root));
    pending.set(root, started);
    return started;
  }

  const isOld = (listing: IndexedRepo): boolean => deps.now() - listing.listedAt > maxAgeMs;

  return {
    async fresh(root) {
      const listing = listings.get(root);
      return listing === undefined || isOld(listing) ? list(root) : ok(listing);
    },
    async current(root) {
      const listing = listings.get(root);
      if (listing === undefined) return list(root);
      if (isOld(listing)) void list(root);
      return ok(listing);
    },
  };
}
