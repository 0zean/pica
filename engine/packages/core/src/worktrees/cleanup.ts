import type { WorktreeInfo } from "./list.ts";

// What the adapter learned about one linked worktree. Times are milliseconds since the epoch.
export interface WorktreeFacts {
  readonly worktree: WorktreeInfo;
  // When Pica created the worktree; null for worktrees made outside Pica.
  readonly createdAt: number | null;
  // Committer time of the checked-out commit; null when there is none.
  readonly lastCommitAt: number | null;
  // The checked-out commit is reachable from the base, so removing the worktree loses no commits.
  readonly merged: boolean;
  readonly dirty: boolean;
}

export type WorktreeAgeSource = "created" | "last_commit" | "unknown";

export interface WorktreeCleanupEntry extends WorktreeFacts {
  readonly ageMs: number | null;
  readonly ageSource: WorktreeAgeSource;
  readonly removable: boolean;
}

export interface WorktreeCleanupReport {
  readonly generatedAt: number;
  readonly base: string;
  readonly entries: readonly WorktreeCleanupEntry[];
}

export function buildWorktreeCleanupReport(
  base: string,
  facts: readonly WorktreeFacts[],
  now: number,
): WorktreeCleanupReport {
  return { generatedAt: now, base, entries: facts.map((fact) => cleanupEntry(fact, now)) };
}

function cleanupEntry(facts: WorktreeFacts, now: number): WorktreeCleanupEntry {
  const ageSource = facts.createdAt !== null ? "created" : facts.lastCommitAt !== null ? "last_commit" : "unknown";
  const since = facts.createdAt ?? facts.lastCommitAt;
  return {
    ...facts,
    ageMs: since === null ? null : Math.max(0, now - since),
    ageSource,
    removable: facts.merged && !facts.dirty && !facts.worktree.locked,
  };
}
