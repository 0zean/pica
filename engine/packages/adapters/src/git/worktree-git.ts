import { err, ok, type GitError, type GitResult } from "@pica/core";
import { runGit, type GitOutput, type GitProcessOptions } from "./run-git.ts";

export async function runWorktreeGitChecked(
  process: GitProcessOptions,
  cwd: string,
  args: readonly string[],
): GitResult<string> {
  const output = await runGit(process, cwd, args);
  if (!output.ok) return output;
  return output.value.exitCode === 0 ? ok(output.value.stdout) : err(worktreeGitFailure(args, output.value));
}

export function worktreeGitFailure(args: readonly string[], output: GitOutput): GitError {
  const stderr = output.stderr.trim();
  const firstLine = stderr.split("\n")[0] ?? "";
  const base = { exitCode: output.exitCode, stderr };
  if (/not a git repository/i.test(stderr)) {
    return { code: "git.not_a_repository", message: firstLine, ...base };
  }
  if (/invalid reference|unknown revision|not a valid (object|commit) name/i.test(stderr)) {
    return { code: "git.unknown_revision", message: firstLine, ...base };
  }
  const message = `git ${args.slice(0, 2).join(" ")} exited with ${String(output.exitCode)}: ${firstLine}`;
  return { code: "git.command_failed", message, ...base };
}
