import { err, ok, type GitError, type GitResult, type RepoCardSource } from "@pica/core";
import { runGit, type GitOutput, type GitProcessOptions } from "./run-git.ts";
import type { GitCliOptions } from "./git-cli-service.ts";

const maxFileBytes = 256 * 1024;
const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

// Reads repository content at a commit for repo cards (R-09).
export function createGitRepoCardSource(options: GitCliOptions = {}): RepoCardSource {
  const process: GitProcessOptions = {
    gitPath: options.gitPath ?? "git",
    env: options.env ?? globalThis.process.env,
  };
  const git = async (cwd: string, args: readonly string[]): GitResult<GitOutput> => runGit(process, cwd, args);

  return {
    async headCommit(repo) {
      const args = ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"];
      const output = await git(repo, args);
      if (!output.ok) return output;
      if (output.value.exitCode === 1) {
        return err({ code: "git.unknown_revision", message: `${repo} has no commits` });
      }
      return output.value.exitCode === 0 ? ok(output.value.stdout.trim()) : err(failure(args, output.value));
    },

    async listFiles(repo, commit) {
      if (!commitPattern.test(commit)) return invalidCommit(commit);
      const args = ["ls-tree", "-r", "-z", "--name-only", commit];
      const output = await git(repo, args);
      if (!output.ok) return output;
      if (output.value.exitCode !== 0) return err(failure(args, output.value));
      return ok(output.value.stdout.split("\0").filter((path) => path !== ""));
    },

    async readFile(repo, commit, path) {
      if (!commitPattern.test(commit)) return invalidCommit(commit);
      const output = await git(repo, ["cat-file", "blob", `${commit}:${path}`]);
      if (!output.ok) return output;
      if (output.value.exitCode !== 0) return ok(null);
      return ok(output.value.stdout.slice(0, maxFileBytes));
    },
  };
}

function invalidCommit(commit: string): { readonly ok: false; readonly error: GitError } {
  return err({ code: "git.invalid_argument", message: `"${commit}" is not a full commit hash` });
}

function failure(args: readonly string[], output: GitOutput): GitError {
  const stderr = output.stderr.trim();
  const code = /not a git repository/i.test(stderr) ? "git.not_a_repository" : "git.command_failed";
  const message = `git ${args[0] ?? ""} exited with ${String(output.exitCode)}: ${stderr.split("\n")[0] ?? ""}`;
  return { code, message, exitCode: output.exitCode, stderr };
}
