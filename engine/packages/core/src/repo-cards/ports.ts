import type { GitResult } from "../git/port.ts";
import type { Result } from "../result.ts";

// Reads a repository at a commit rather than its working tree, so a card matches its cache key.
export interface RepoCardSource {
  headCommit(repo: string): GitResult<string>;
  listFiles(repo: string, commit: string): GitResult<readonly string[]>;
  // null when the path is not a file at that commit.
  readFile(repo: string, commit: string, path: string): GitResult<string | null>;
}

export interface CachedRepoCard {
  readonly key: string;
  readonly text: string;
}

export interface RepoCardCacheError {
  readonly code: string;
  readonly message: string;
}

export interface RepoCardCache {
  get(repoId: string): Promise<Result<CachedRepoCard | null, RepoCardCacheError>>;
  put(repoId: string, card: CachedRepoCard): Promise<Result<undefined, RepoCardCacheError>>;
}
