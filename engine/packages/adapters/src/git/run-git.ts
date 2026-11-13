import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { err, ok, type GitError, type Result } from "@pica/core";

export interface GitProcessOptions {
  readonly gitPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface GitOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Settings that keep output parseable and git non-interactive whatever the user's config says.
const fixedConfig = ["-c", "core.quotePath=false", "-c", "color.ui=false", "-c", "diff.suppressBlankEmpty=false"];
const fixedEnv = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", LANG: "C" };

export function runGit(
  options: GitProcessOptions,
  cwd: string,
  args: readonly string[],
  input?: string,
): Promise<Result<GitOutput, GitError>> {
  return new Promise((resolve) => {
    const child = spawn(options.gitPath, [...fixedConfig, ...args], {
      cwd,
      env: { ...options.env, ...fixedEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve(err(spawnError(options.gitPath, cwd, error)));
    });
    child.on("close", (code) => {
      resolve(
        ok({
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        }),
      );
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ?? "");
  });
}

function spawnError(gitPath: string, cwd: string, error: NodeJS.ErrnoException): GitError {
  if (error.code === "ENOENT" && !existsSync(cwd)) {
    return { code: "git.not_a_repository", message: `${cwd} does not exist` };
  }
  if (error.code === "ENOENT") {
    return { code: "git.not_installed", message: `could not run "${gitPath}" in ${cwd}: ${error.message}` };
  }
  return { code: "git.command_failed", message: `could not run "${gitPath}": ${error.message}` };
}
