import type { GitResult } from "../git/port.ts";
import type { Result } from "../result.ts";

// Git operations the registry needs beyond the R-01 GitService. Every method takes a directory and
// never throws.
export interface RepoRegistryGit {
  topLevel(path: string): GitResult<string>;
  remoteUrl(repo: string, remote: string): GitResult<string | null>;
  defaultBranch(repo: string): GitResult<string | null>;
  partialClone(url: string, destination: string): GitResult<undefined>;
  // Commits on local branches that no remote-tracking ref contains.
  unpushedCommitCount(repo: string): GitResult<number>;
}

export interface RepoRegistryDirectories {
  exists(path: string): Promise<boolean>;
  removeTree(path: string): Promise<Result<undefined, { readonly code: string; readonly message: string }>>;
}
