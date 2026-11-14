import type { Result } from "../result.ts";
import type { RealPathResolver } from "../sandbox/real-paths.ts";
import type { CloneState, Repo } from "../store/entities.ts";
import type { RepoToolError } from "./errors.ts";

export type RepoFileContent =
  | { readonly kind: "text"; readonly text: string; readonly truncated: boolean }
  | { readonly kind: "binary" }
  // A directory, a symlink, or nothing at all.
  | { readonly kind: "not_a_file" };

export interface RepoFiles {
  // Repo-relative paths of the working tree: tracked files plus untracked ones that are not ignored.
  listFiles(root: string): Promise<Result<readonly string[], RepoToolError>>;
  // Reads at most `maxBytes`. Never follows a symlink: callers pass the resolved path.
  readFile(absolutePath: string, maxBytes: number): Promise<Result<RepoFileContent, RepoToolError>>;
}

export interface RepoToolLimits {
  readonly defaultResults: number;
  readonly maxResults: number;
  readonly maxSearchFileBytes: number;
  readonly maxReadBytes: number;
  readonly maxReadLines: number;
  readonly maxListEntries: number;
}

export const defaultRepoToolLimits: RepoToolLimits = {
  defaultResults: 50,
  maxResults: 200,
  maxSearchFileBytes: 1024 * 1024,
  maxReadBytes: 256 * 1024,
  maxReadLines: 2000,
  maxListEntries: 500,
};

export interface RepoToolsDeps {
  // The repos of the session's workspace (R-06 `WorkspaceService.repos(workspaceId)`).
  repos(): Promise<Result<readonly Repo[], RepoToolError>>;
  // The lazy clone (R-06 `ensureCloned`); without it a repo that is not cloned is `not_cloned`.
  ensureCloned?(repoId: string): Promise<Result<Repo, RepoToolError>>;
  readonly files: RepoFiles;
  readonly realPath: RealPathResolver;
  readonly limits?: Partial<RepoToolLimits>;
}

export interface RepoSummary {
  readonly mention: string;
  readonly qualifiedName: string;
  readonly cloneState: CloneState;
}
