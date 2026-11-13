import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  buildWorktreeCleanupReport,
  err,
  ok,
  parseWorktreeList,
  worktreeBranchName,
  worktreeListArgs,
  type GitService,
  type Result,
  type WorktreeCleanupReport,
  type WorktreeCreateOptions,
  type WorktreeError,
  type WorktreeFacts,
  type WorktreeInfo,
  type WorktreeResult,
  type WorktreeService,
} from "@pica/core";
import { createGitCliService, type GitCliOptions } from "./git-cli-service.ts";
import { runGit, type GitProcessOptions } from "./run-git.ts";
import { gatherWorktreeFacts, recordCreatedAt } from "./worktree-facts.ts";
import { runWorktreeGitChecked } from "./worktree-git.ts";

export interface GitWorktreeOptions extends GitCliOptions {
  // Milliseconds since the epoch; injected so creation times and ages are deterministic in tests.
  readonly now?: () => number;
}

interface Context {
  readonly process: GitProcessOptions;
  readonly git: GitService;
  readonly now: () => number;
}

export function createGitWorktreeService(options: GitWorktreeOptions = {}): WorktreeService {
  const context: Context = {
    process: { gitPath: options.gitPath ?? "git", env: options.env ?? globalThis.process.env },
    git: createGitCliService(options),
    now: options.now ?? Date.now,
  };
  return {
    list: (repo) => listWorktrees(context, repo),
    create: (repo, createOptions) => createWorktree(context, repo, createOptions),
    remove: (repo, path, removeOptions) => removeWorktree(context, repo, path, removeOptions?.force === true),
    cleanupReport: (repo, cleanupOptions) => cleanupReport(context, repo, cleanupOptions?.base),
  };
}

async function listWorktrees(context: Context, repo: string): WorktreeResult<WorktreeInfo[]> {
  const output = await runWorktreeGitChecked(context.process, repo, worktreeListArgs);
  return output.ok ? parseWorktreeList(output.value) : output;
}

async function createWorktree(context: Context, repo: string, options: WorktreeCreateOptions): WorktreeResult<WorktreeInfo> {
  const branch = worktreeBranchName(options.slug);
  if (!branch.ok) return branch;
  const checked = await checkCreate(context, repo, branch.value, options);
  if (!checked.ok) return checked;
  const base = options.base ?? "HEAD";
  const added = await runWorktreeGitChecked(context.process, repo, [
    "worktree", "add", "--quiet", "-b", branch.value, options.path, base,
  ]);
  if (!added.ok) return added;
  const recorded = await recordCreatedAt(context.process, options.path, context.now());
  if (!recorded.ok) return recorded;
  return findWorktree(context, repo, options.path);
}

async function checkCreate(
  context: Context,
  repo: string,
  branch: string,
  options: WorktreeCreateOptions,
): WorktreeResult<undefined> {
  if (!isAbsolute(options.path)) return invalidArgument(`the worktree path must be absolute, not "${options.path}"`);
  if (options.base?.startsWith("-") === true || options.base === "") {
    return invalidArgument(`"${options.base}" is not a valid base`);
  }
  if (existsSync(options.path)) {
    return err({ code: "worktree.path_exists", message: `${options.path} already exists` });
  }
  const existing = await runGit(context.process, repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (!existing.ok) return existing;
  if (existing.value.exitCode === 0) {
    return err({ code: "worktree.branch_exists", message: `the branch ${branch} already exists` });
  }
  return ok(undefined);
}

async function removeWorktree(context: Context, repo: string, path: string, force: boolean): WorktreeResult<undefined> {
  const found = await findWorktree(context, repo, path);
  if (!found.ok) return found;
  const worktree = found.value;
  if (worktree.main) {
    return err({ code: "worktree.is_main", message: `${worktree.path} is the repository's main worktree` });
  }
  if (!force && !worktree.prunable) {
    const status = await context.git.status(worktree.path);
    if (!status.ok) return status;
    if (status.value.entries.length > 0) {
      const count = String(status.value.entries.length);
      return err({ code: "worktree.dirty", message: `${worktree.path} has ${count} uncommitted or untracked changes` });
    }
  }
  // A second --force also removes a locked worktree.
  const args = ["worktree", "remove", ...(force ? ["--force", "--force"] : []), worktree.path];
  const removed = await runWorktreeGitChecked(context.process, repo, args);
  return removed.ok ? ok(undefined) : removed;
}

async function cleanupReport(context: Context, repo: string, baseOption?: string): WorktreeResult<WorktreeCleanupReport> {
  const worktrees = await listWorktrees(context, repo);
  if (!worktrees.ok) return worktrees;
  const main = worktrees.value.find((worktree) => worktree.main);
  const base = baseOption ?? main?.branch ?? main?.head;
  if (base === undefined || base === null || base === "" || base.startsWith("-")) {
    return invalidArgument("no base to measure merged state against; pass one");
  }
  const linked = worktrees.value.filter((worktree) => !worktree.main && !worktree.bare);
  const facts = await Promise.all(
    linked.map((worktree) => gatherWorktreeFacts(context.process, context.git, repo, worktree, base)),
  );
  const values: WorktreeFacts[] = [];
  for (const fact of facts) {
    if (!fact.ok) return fact;
    values.push(fact.value);
  }
  return ok(buildWorktreeCleanupReport(base, values, context.now()));
}

async function findWorktree(context: Context, repo: string, path: string): WorktreeResult<WorktreeInfo> {
  const worktrees = await listWorktrees(context, repo);
  if (!worktrees.ok) return worktrees;
  const wanted = canonicalPath(path);
  const match = worktrees.value.find((worktree) => canonicalPath(worktree.path) === wanted);
  return match === undefined ? err({ code: "worktree.not_found", message: `${path} is not a worktree of ${repo}` }) : ok(match);
}

// Git may record a path through a symlink (macOS /var is /private/var); compare real paths when they exist.
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function invalidArgument(message: string): Result<never, WorktreeError> {
  return err({ code: "git.invalid_argument", message });
}
