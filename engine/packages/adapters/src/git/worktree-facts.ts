import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  err,
  ok,
  type GitResult,
  type GitService,
  type WorktreeFacts,
  type WorktreeInfo,
} from "@pica/core";
import { runGit, type GitProcessOptions } from "./run-git.ts";
import { runWorktreeGitChecked, worktreeGitFailure } from "./worktree-git.ts";

// Kept in git's own directory for the worktree, so `git worktree remove` deletes it too.
const createdAtFile = "pica-created-at";

export async function recordCreatedAt(process: GitProcessOptions, worktreePath: string, now: number): GitResult<undefined> {
  const gitDir = await runWorktreeGitChecked(process, worktreePath, ["rev-parse", "--absolute-git-dir"]);
  if (!gitDir.ok) return gitDir;
  try {
    await writeFile(join(gitDir.value.trim(), createdAtFile), `${new Date(now).toISOString()}\n`);
    return ok(undefined);
  } catch (error) {
    return err({ code: "git.command_failed", message: `could not record the creation time: ${String(error)}` });
  }
}

export async function gatherWorktreeFacts(
  process: GitProcessOptions,
  git: GitService,
  repo: string,
  worktree: WorktreeInfo,
  base: string,
): GitResult<WorktreeFacts> {
  const dirty = worktree.prunable ? ok(false) : await isDirty(git, worktree.path);
  if (!dirty.ok) return dirty;
  const merged = worktree.head === null ? ok(false) : await isAncestor(process, repo, worktree.head, base);
  if (!merged.ok) return merged;
  const lastCommitAt = worktree.head === null ? ok(null) : await commitTime(git, repo, worktree.head);
  if (!lastCommitAt.ok) return lastCommitAt;
  const createdAt = worktree.prunable ? null : await readCreatedAt(process, worktree.path);
  return ok({ worktree, createdAt, lastCommitAt: lastCommitAt.value, merged: merged.value, dirty: dirty.value });
}

async function isDirty(git: GitService, path: string): GitResult<boolean> {
  const status = await git.status(path);
  return status.ok ? ok(status.value.entries.length > 0) : status;
}

async function isAncestor(process: GitProcessOptions, repo: string, commit: string, base: string): GitResult<boolean> {
  const args = ["merge-base", "--is-ancestor", "--end-of-options", commit, base];
  const output = await runGit(process, repo, args);
  if (!output.ok) return output;
  if (output.value.exitCode === 0 || output.value.exitCode === 1) return ok(output.value.exitCode === 0);
  return err(worktreeGitFailure(args, output.value));
}

async function commitTime(git: GitService, repo: string, commit: string): GitResult<number | null> {
  const log = await git.log(repo, { ref: commit, maxCount: 1 });
  if (!log.ok) return log;
  const committedAt = log.value[0]?.committedAt;
  return ok(committedAt === undefined ? null : committedAt * 1000);
}

// A missing or unreadable marker means the worktree was not made by Pica; that is not an error.
async function readCreatedAt(process: GitProcessOptions, worktreePath: string): Promise<number | null> {
  const gitDir = await runWorktreeGitChecked(process, worktreePath, ["rev-parse", "--absolute-git-dir"]);
  if (!gitDir.ok) return null;
  try {
    const time = Date.parse((await readFile(join(gitDir.value.trim(), createdAtFile), "utf8")).trim());
    return Number.isNaN(time) ? null : time;
  } catch {
    return null;
  }
}
