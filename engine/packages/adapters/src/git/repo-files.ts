import { lstat, open } from "node:fs/promises";
import { err, ok, repoToolError, type RepoFileContent, type RepoFiles, type RepoToolError, type Result } from "@pica/core";
import { runGit, type GitProcessOptions } from "./run-git.ts";
import type { GitCliOptions } from "./git-cli-service.ts";

const binarySniffBytes = 8000;

// Working-tree files for the repo tools (R-08): git decides what is listed, so ignored files and
// `.git` never show up.
export function createGitRepoFiles(options: GitCliOptions = {}): RepoFiles {
  const process: GitProcessOptions = {
    gitPath: options.gitPath ?? "git",
    env: options.env ?? globalThis.process.env,
  };
  return {
    async listFiles(root) {
      const output = await runGit(process, root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
      if (!output.ok) return err(repoToolError("repo_tools.io_failed", output.error.message));
      if (output.value.exitCode !== 0) {
        return err(repoToolError("repo_tools.io_failed", `git ls-files failed in ${root}: ${output.value.stderr.trim()}`));
      }
      // A conflicted path is listed once per stage.
      return ok([...new Set(output.value.stdout.split("\0").filter((path) => path !== ""))]);
    },
    readFile,
  };
}

async function readFile(absolutePath: string, maxBytes: number): Promise<Result<RepoFileContent, RepoToolError>> {
  try {
    const stats = await lstat(absolutePath);
    if (!stats.isFile()) return ok({ kind: "not_a_file" });
    const handle = await open(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stats.size, maxBytes));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.subarray(0, binarySniffBytes).includes(0)) return ok({ kind: "binary" });
      return ok({ kind: "text", text: bytes.toString("utf8"), truncated: stats.size > maxBytes });
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return ok({ kind: "not_a_file" });
    return err(repoToolError("repo_tools.io_failed", `could not read ${absolutePath}: ${String(error)}`));
  }
}
