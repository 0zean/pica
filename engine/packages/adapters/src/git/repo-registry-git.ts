import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { err, ok, type GitError, type GitResult, type RepoRegistryGit } from "@pica/core";
import { runGit, type GitOutput, type GitProcessOptions } from "./run-git.ts";
import type { GitCliOptions } from "./git-cli-service.ts";

// The registry's git operations (R-03), kept apart from the R-01 GitService.
export function createGitRepoRegistryOps(options: GitCliOptions = {}): RepoRegistryGit {
  const process: GitProcessOptions = {
    gitPath: options.gitPath ?? "git",
    env: options.env ?? globalThis.process.env,
  };
  const git = async (cwd: string, args: readonly string[]): GitResult<GitOutput> => runGit(process, cwd, args);

  return {
    async topLevel(path) {
      return trimmed(await git(path, ["rev-parse", "--show-toplevel"]), ["rev-parse"]);
    },

    async remoteUrl(repo, remote) {
      if (remote === "" || remote.startsWith("-")) return invalidArgument(`"${remote}" is not a remote name`);
      const output = await git(repo, ["config", "--get", `remote.${remote}.url`]);
      if (output.ok && output.value.exitCode === 1) return ok(null);
      return trimmed(output, ["config"]);
    },

    async defaultBranch(repo) {
      const remoteHead = await git(repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
      if (remoteHead.ok && remoteHead.value.exitCode === 0) {
        return ok(remoteHead.value.stdout.trim().replace(/^origin\//, ""));
      }
      const head = await git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      if (head.ok && head.value.exitCode === 1) return ok(null);
      return trimmed(head, ["symbolic-ref"]);
    },

    async partialClone(url, destination) {
      const parent = dirname(destination);
      await mkdir(parent, { recursive: true });
      const args = ["clone", "--quiet", "--filter=blob:none", "--origin", "origin", "--", url, destination];
      const output = await git(parent, args);
      if (!output.ok) return output;
      return output.value.exitCode === 0 ? ok(undefined) : err(failure(args, output.value));
    },

    async unpushedCommitCount(repo) {
      const counted = trimmed(await git(repo, ["rev-list", "--count", "--branches", "--not", "--remotes"]), ["rev-list"]);
      if (!counted.ok) return counted;
      const count = Number(counted.value);
      return Number.isInteger(count)
        ? ok(count)
        : err({ code: "git.parse_failed", message: `could not parse rev-list count "${counted.value}"` });
    },
  };
}

function trimmed(output: Awaited<GitResult<GitOutput>>, args: readonly string[]): Awaited<GitResult<string>> {
  if (!output.ok) return output;
  return output.value.exitCode === 0 ? ok(output.value.stdout.trim()) : err(failure(args, output.value));
}

function invalidArgument(message: string): { readonly ok: false; readonly error: GitError } {
  return err({ code: "git.invalid_argument", message });
}

function failure(args: readonly string[], output: GitOutput): GitError {
  const stderr = output.stderr.trim();
  const code = /not a git repository/i.test(stderr) ? "git.not_a_repository" : "git.command_failed";
  const message = `git ${args[0] ?? ""} exited with ${String(output.exitCode)}: ${stderr.split("\n")[0] ?? ""}`;
  return { code, message, exitCode: output.exitCode, stderr };
}
