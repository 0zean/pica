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
  // When set, only this gh is run. Otherwise `gh` on PATH, then `fallbackGhPaths`.
  readonly ghPath?: string;
}

// Where Homebrew (Apple silicon, Intel) and MacPorts install gh. Tried when `gh` is not on the engine's PATH, as when
// an app opened from Finder did not pass the login shell's PATH on (docs/app-shell.md#the-engines-path).
export const fallbackGhPaths: readonly string[] = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/opt/local/bin/gh"];

// Reuses the token the user already gave the GitHub CLI (`gh auth login`), including GH_TOKEN.
export function createGhCliCredentialProvider(options: GhCliProviderOptions): GitHubCredentialProvider {
  return {
    kind: "gh",
    async token(request) {
      const args = ["auth", "token", "--hostname", request.host.host];
      let output: GitHubCommandOutput | null = null;
      for (const gh of options.ghPath === undefined ? ["gh", ...fallbackGhPaths] : [options.ghPath]) {
        output = await options.run(gh, args);
        if (output !== null) {
          break;
        }
      }
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
