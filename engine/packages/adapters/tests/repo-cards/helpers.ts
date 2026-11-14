import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitError, Result } from "@pica/core";

const makeEcosystems = join(import.meta.dirname, "../../../testkit/fixtures/repo-cards/make-ecosystems.sh");

export const ecosystems = ["go", "node", "python", "swift"] as const;

export const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Pica Test",
  GIT_AUTHOR_EMAIL: "test@pica.test",
  GIT_COMMITTER_NAME: "Pica Test",
  GIT_COMMITTER_EMAIL: "test@pica.test",
  GIT_AUTHOR_DATE: "@1700000600 +0000",
  GIT_COMMITTER_DATE: "@1700000600 +0000",
};

export function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pica-cards-"));
  execFileSync(makeEcosystems, [join(root, "repos")], { env: gitEnv, stdio: "pipe" });
  return root;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
}

export function value<T, E extends { readonly code: string; readonly message: string } = GitError>(
  result: Result<T, E>,
): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}
