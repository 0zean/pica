import { spawn } from "node:child_process";
import { ok, type GitHubCredentialProvider } from "@pica/core";

export interface GitHubCommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
}

// Runs a command to completion. `null` means it could not be started (for example, not installed).
export type GitHubCommandRunner = (command: string, args: readonly string[]) => Promise<GitHubCommandOutput | null>;

export interface GhCliProviderOptions {
  readonly run: GitHubCommandRunner;
  readonly ghPath?: string;
}

// Reuses the token the user already gave the GitHub CLI (`gh auth login`), including GH_TOKEN.
export function createGhCliCredentialProvider(options: GhCliProviderOptions): GitHubCredentialProvider {
  return {
    kind: "gh",
    async token(request) {
      const output = await options.run(options.ghPath ?? "gh", ["auth", "token", "--hostname", request.host.host]);
      if (output === null || output.exitCode !== 0) {
        return ok(null);
      }
      const token = output.stdout.trim();
      return ok(token.length === 0 ? null : token);
    },
  };
}

export function spawnGitHubCommand(env: Readonly<Record<string, string | undefined>>): GitHubCommandRunner {
  return (command, args) =>
    new Promise((resolve) => {
      const child = spawn(command, args, { env: { ...env, GH_PROMPT_DISABLED: "1" }, stdio: ["ignore", "pipe", "ignore"] });
      const stdout: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => {
        stdout.push(chunk);
      });
      child.on("error", () => {
        resolve(null);
      });
      child.on("close", (code) => {
        resolve({ exitCode: code ?? -1, stdout: Buffer.concat(stdout).toString("utf8") });
      });
    });
}
