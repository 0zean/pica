import type { WorktreeInfo } from "../worktrees/list.ts";
import type { GitHubRepoRef } from "./ports.ts";

// One repository a change set writes to.
export interface ChangeSetRepo {
  // Any working directory of the local repository.
  readonly repo: string;
  readonly github: GitHubRepoRef;
  // Branch the pull request merges into, usually the default branch.
  readonly baseBranch: string;
  // Absolute path for this repository's worktree; it must not exist yet.
  readonly worktreePath: string;
}

export interface ChangeSetMember extends ChangeSetRepo {
  readonly worktree: WorktreeInfo;
  // The commit the worktree started from, which per-repo diffs are measured against; null in an unborn repository.
  readonly baseCommit: string | null;
}

// One session's writes across several repositories, all on the same `pica/<slug>` branch.
export interface ChangeSet {
  readonly slug: string;
  readonly branch: string;
  readonly members: readonly ChangeSetMember[];
}

export interface ChangeSetFailure {
  readonly code: string;
  readonly message: string;
}
