import type { GitErrorCode } from "../git/errors.ts";

export type WorktreeErrorCode =
  | GitErrorCode
  | "worktree.invalid_slug"
  | "worktree.branch_exists"
  | "worktree.path_exists"
  | "worktree.not_found"
  | "worktree.is_main"
  | "worktree.dirty";

// A GitError is a WorktreeError, so git failures pass through unchanged.
export interface WorktreeError {
  readonly code: WorktreeErrorCode;
  readonly message: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}
