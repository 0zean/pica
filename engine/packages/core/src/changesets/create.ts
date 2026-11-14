import { err, ok, type Result } from "../result.ts";
import { worktreeBranchName } from "../worktrees/branch-name.ts";
import type { WorktreeService } from "../worktrees/port.ts";
import type { ChangeSet, ChangeSetFailure, ChangeSetMember, ChangeSetRepo } from "./types.ts";

export interface ChangeSetCreateOptions {
  readonly slug: string;
  readonly repos: readonly ChangeSetRepo[];
}

// Worktrees already made stay in place so the caller can see them, retry, or remove them.
export interface ChangeSetCreateError extends ChangeSetFailure {
  readonly failedRepo: string | null;
  readonly created: readonly ChangeSetMember[];
}

// Creates a worktree on `pica/<slug>` in each repository, in order, stopping at the first failure.
export async function createChangeSet(
  worktrees: WorktreeService,
  options: ChangeSetCreateOptions,
): Promise<Result<ChangeSet, ChangeSetCreateError>> {
  const branch = worktreeBranchName(options.slug);
  if (!branch.ok) {
    return err({ ...failure(branch.error), failedRepo: null, created: [] });
  }
  const duplicate = firstDuplicateRepo(options.repos);
  if (duplicate !== undefined) {
    return err({
      code: "changeset.duplicate_repo",
      message: `${duplicate} appears more than once in the change set`,
      failedRepo: duplicate,
      created: [],
    });
  }
  const members: ChangeSetMember[] = [];
  for (const repo of options.repos) {
    const created = await worktrees.create(repo.repo, { slug: options.slug, path: repo.worktreePath });
    if (!created.ok) {
      return err({ ...failure(created.error), failedRepo: repo.repo, created: members });
    }
    members.push({ ...repo, worktree: created.value, baseCommit: created.value.head });
  }
  return ok({ slug: options.slug, branch: branch.value, members });
}

// The session's write roots for this change set: one worktree per repository.
export function changeSetWriteRoots(changeSet: ChangeSet): string[] {
  return changeSet.members.map((member) => member.worktree.path);
}

function firstDuplicateRepo(repos: readonly ChangeSetRepo[]): string | undefined {
  const seen = new Set<string>();
  for (const repo of repos) {
    const key = `${repo.github.owner}/${repo.github.name}`.toLowerCase();
    if (seen.has(key)) {
      return key;
    }
    seen.add(key);
  }
  return undefined;
}

function failure(error: { readonly code: string; readonly message: string }): ChangeSetFailure {
  return { code: error.code, message: error.message };
}
