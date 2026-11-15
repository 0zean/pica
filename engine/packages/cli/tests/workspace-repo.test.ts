import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROCESS_TEST_TIMEOUT_MS, cliHarness } from "./helpers.ts";
import type { CliHarness } from "./helpers.ts";

// E-11: what Milestone M1 needs before `session new`: a workspace and a repo registered by path.

const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

function makeRepo(path: string): string {
  mkdirSync(path, { recursive: true });
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: path, env: gitEnv, stdio: "pipe" });
  };
  git("init", "--quiet", "--initial-branch=main");
  writeFileSync(join(path, "README.md"), "# Acme API\n");
  git("add", ".");
  git("-c", "user.name=Pica Test", "-c", "user.email=test@pica.test", "commit", "--quiet", "-m", "Initial commit");
  git("remote", "add", "origin", "git@github.com:acme/ledger.git");
  return realpathSync(path);
}

let cli: CliHarness;

beforeEach(async () => {
  cli = await cliHarness();
});

afterEach(async () => {
  await cli.stop();
});

describe("pica workspace and repo", { timeout: PROCESS_TEST_TIMEOUT_MS }, () => {
  it("creates a workspace, adds the current directory as a repo pinned to it, and lists both", async () => {
    const repo = makeRepo(join(cli.dir, "src", "api"));

    expect(await cli.run(["workspace", "create", "My", "team"])).toEqual({ code: 0, stdout: "Workspace id-1\n", stderr: "" });
    const added = await cli.run(["repo", "add", ".", "--workspace", "id-1"], {}, repo);
    expect(added).toEqual({ code: 0, stdout: "Repo id-2 https://github.com/acme/ledger\n", stderr: "" });

    const workspaces = await cli.run(["workspace", "list"]);
    // ws-1 is the fake engine's seeded workspace.
    expect(workspaces.stdout).toBe("ID    NAME      PINNED\nid-1  My team   1\nws-1  Payments  0\n");
    const repos = await cli.run(["--json", "repo", "list", "--workspace", "id-1"]);
    expect(JSON.parse(repos.stdout)).toEqual({
      repos: [{ id: "id-2", remoteUrl: "https://github.com/acme/ledger", localPath: repo, managed: false, defaultBranch: "main", cloneState: "cloned" }],
    });
  });

  it("reports a directory that is not a git checkout as an engine error", async () => {
    const plain = join(cli.dir, "plain");
    mkdirSync(plain);
    const added = await cli.run(["repo", "add", plain]);
    expect(added.code).toBe(3);
    expect(added.stdout).toBe("");
  });

  it("rejects `repo add` without a path as a usage error", async () => {
    const added = await cli.run(["repo", "add"]);
    expect(added).toMatchObject({ code: 2, stdout: "" });
    expect(added.stderr).toContain("Missing a repository path.");
  });
});
