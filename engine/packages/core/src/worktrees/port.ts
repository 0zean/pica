import type { Result } from "../result.ts";
import type { WorktreeCleanupReport } from "./cleanup.ts";
import type { WorktreeError } from "./errors.ts";
import type { WorktreeInfo } from "./list.ts";

export interface WorktreeCreateOptions {
  // The branch is named `pica/<slug>`.
  readonly slug: string;
  // Absolute path of the new worktree; it must not exist yet.
  readonly path: string;
  // Commit the new branch starts from; defaults to the repository's HEAD.
  readonly base?: string;
}

export interface WorktreeRemoveOptions {
  // Remove even when the worktree has uncommitted or untracked changes, or is locked.
  readonly force?: boolean;
}

export interface WorktreeCleanupOptions {
  // Ref that "merged" is measured against; defaults to the main worktree's branch.
  readonly base?: string;
}

export type WorktreeResult<T> = Promise<Result<T, WorktreeError>>;

// `repo` is any working directory of the repository. Methods never throw.
export interface WorktreeService {
  create(repo: string, options: WorktreeCreateOptions): WorktreeResult<WorktreeInfo>;
  list(repo: string): WorktreeResult<WorktreeInfo[]>;
  remove(repo: string, path: string, options?: WorktreeRemoveOptions): WorktreeResult<undefined>;
  cleanupReport(repo: string, options?: WorktreeCleanupOptions): WorktreeResult<WorktreeCleanupReport>;
}
