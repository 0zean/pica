import { parseGitVersion } from "@pica/core";
import type { GitInstallation } from "@pica/core";
import { runGit } from "./run-git.ts";

export interface GitProbeOptions {
  readonly gitPath?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  // Any existing directory: git needs one to start in.
  readonly cwd: string;
}

// Runs `git --version`. On macOS without the Command Line Tools, `/usr/bin/git` is a stub that exits
// non-zero and asks for them, so a failed run counts as missing too.
export async function probeGitInstall(options: GitProbeOptions): Promise<GitInstallation> {
  const ran = await runGit({ gitPath: options.gitPath ?? "git", env: options.env }, options.cwd, ["--version"]);
  if (!ran.ok) return missing(ran.error.message);
  const { exitCode, stdout, stderr } = ran.value;
  const version = exitCode === 0 ? parseGitVersion(stdout) : null;
  if (version !== null) return { status: "installed", version, message: null };
  const said = stderr.trim().split("\n")[0] ?? "";
  return missing(said === "" ? `git --version exited with ${String(exitCode)}` : said);
}

function missing(message: string): GitInstallation {
  return { status: "missing", version: null, message };
}
