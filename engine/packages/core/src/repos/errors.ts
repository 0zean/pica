export type RepoRegistryErrorCode =
  | "repo.invalid_url"
  | "repo.no_remote"
  | "repo.not_found"
  | "repo.path_exists"
  | "repo.clone_failed"
  | "repo.has_local_work"
  | "repo.outside_managed_root"
  | "repo.git_failed"
  | "repo.store_failed"
  | "repo.filesystem_failed";

export interface RepoLocalWork {
  readonly uncommittedPaths: readonly string[];
  readonly unpushedCommits: number;
}

export interface RepoRegistryError {
  readonly code: RepoRegistryErrorCode;
  readonly message: string;
  readonly cause?: { readonly code: string; readonly message: string };
  readonly localWork?: RepoLocalWork;
}

export function repoRegistryError(
  code: RepoRegistryErrorCode,
  message: string,
  cause?: { readonly code: string; readonly message: string },
): RepoRegistryError {
  return cause === undefined ? { code, message } : { code, message, cause: { code: cause.code, message: cause.message } };
}
