import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@pica/core";

// Fixed identity and dates keep commit hashes and times the same on every run.
export const fixtureCommitTime = 1_700_000_000;

export const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Pica Test",
  GIT_AUTHOR_EMAIL: "test@pica.test",
  GIT_COMMITTER_NAME: "Pica Test",
  GIT_COMMITTER_EMAIL: "test@pica.test",
  GIT_AUTHOR_DATE: `@${String(fixtureCommitTime)} +0000`,
  GIT_COMMITTER_DATE: `@${String(fixtureCommitTime)} +0000`,
};

export interface WorktreeFixture {
  readonly root: string;
  readonly repo: string;
  path(name: string): string;
  cleanup(): void;
}

// A repository on `main` with one commit containing README.md, inside a fresh temporary directory.
export function makeWorktreeFixture(): WorktreeFixture {
  const root = mkdtempSync(join(tmpdir(), "pica-worktrees-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  shell(repo, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(repo, "README.md"), "hello\n");
  shell(repo, "add", "README.md");
  shell(repo, "commit", "--quiet", "-m", "Initial commit");
  return {
    root,
    repo,
    path: (name) => join(root, name),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function shell(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
}

// Commits every change in `cwd` with the committer time `seconds`.
export function commitAll(cwd: string, message: string, seconds: number): void {
  const date = `@${String(seconds)} +0000`;
  execFileSync("git", ["add", "--all"], { cwd, env: gitEnv });
  execFileSync("git", ["commit", "--quiet", "-m", message], {
    cwd,
    env: { ...gitEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

export function value<T, E extends { code: string; message: string }>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

export function errorCode<T, E extends { code: string }>(result: Result<T, E>): string | undefined {
  return result.ok ? undefined : result.error.code;
}
