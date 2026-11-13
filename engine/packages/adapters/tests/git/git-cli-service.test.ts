import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitError, GitService, Result } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitCliService } from "../../src/index.ts";

const makeRepos = join(import.meta.dirname, "../../../testkit/fixtures/git/make-repos.sh");

const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Pica Test",
  GIT_AUTHOR_EMAIL: "test@pica.test",
  GIT_COMMITTER_NAME: "Pica Test",
  GIT_COMMITTER_EMAIL: "test@pica.test",
};

let root: string;
let work: string;
let git: GitService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pica-git-"));
  execFileSync(makeRepos, [join(root, "fixtures")], { env, stdio: "pipe" });
  work = join(root, "fixtures/work");
  git = createGitCliService({ env });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function value<T>(result: Result<T, GitError>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function errorCode<T>(result: Result<T, GitError>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

function shell(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8" });
}

describe("status", () => {
  it("reports branch tracking and every kind of change in the fixture", async () => {
    const status = value(await git.status(work));
    expect(status.branch).toMatchObject({ head: "main", upstream: "origin/main", ahead: 1, behind: 0 });
    expect(status.entries).toEqual([
      expect.objectContaining({ kind: "changed", path: "doomed.txt", index: "deleted" }),
      expect.objectContaining({ kind: "changed", path: "image.bin", worktree: "modified" }),
      expect.objectContaining({ kind: "renamed", path: "new-name.txt", originalPath: "old-name.txt" }),
      expect.objectContaining({ kind: "changed", path: "notes.txt", worktree: "modified" }),
      expect.objectContaining({
        kind: "changed",
        path: "vendor/lib",
        submodule: { commitChanged: true, trackedChanges: true, untrackedChanges: false },
      }),
      { kind: "untracked", path: "untracked file.txt" },
    ]);
  });

  it("returns not_a_repository outside a repository and for a missing directory", async () => {
    expect(errorCode(await git.status(root))).toBe("git.not_a_repository");
    expect(errorCode(await git.status(join(root, "missing")))).toBe("git.not_a_repository");
  });

  it("returns not_installed when the git binary is missing", async () => {
    const broken = createGitCliService({ env, gitPath: join(root, "no-such-git") });
    expect(errorCode(await broken.status(work))).toBe("git.not_installed");
  });
});

describe("diff", () => {
  it("separates unstaged, staged, and HEAD diffs", async () => {
    const paths = (files: { path: string }[]): string[] => files.map((file) => file.path);
    expect(paths(value(await git.diff(work, { kind: "unstaged" })))).toEqual(["image.bin", "notes.txt", "vendor/lib"]);
    expect(paths(value(await git.diff(work, { kind: "staged" })))).toEqual(["doomed.txt", "new-name.txt"]);
    expect(paths(value(await git.diff(work, { kind: "head" })))).toEqual([
      "doomed.txt",
      "image.bin",
      "new-name.txt",
      "notes.txt",
      "vendor/lib",
    ]);
  });

  it("reports renames, binary files, and submodules", async () => {
    const files = value(await git.diff(work, { kind: "head" }));
    expect(files.find((file) => file.path === "new-name.txt")).toMatchObject({
      change: "renamed",
      oldPath: "old-name.txt",
      similarity: 90,
    });
    expect(files.find((file) => file.path === "image.bin")).toMatchObject({ binary: true, hunks: [] });
    expect(files.find((file) => file.path === "vendor/lib")?.submodule).toMatchObject({ dirty: true });
  });

  it("limits a diff to paths and compares two commits", async () => {
    expect(value(await git.diff(work, { kind: "head" }, ["notes.txt"])).map((file) => file.path)).toEqual(["notes.txt"]);
    const between = value(await git.diff(work, { kind: "commits", from: "HEAD~1", to: "HEAD" }));
    expect(between).toEqual([expect.objectContaining({ path: "notes.txt", change: "modified" })]);
  });

  it("rejects option-like revisions and reports unknown ones", async () => {
    expect(errorCode(await git.diff(work, { kind: "commits", from: "--output=x", to: "HEAD" }))).toBe(
      "git.invalid_argument",
    );
    expect(errorCode(await git.diff(work, { kind: "commits", from: "nope", to: "HEAD" }))).toBe("git.unknown_revision");
  });
});

describe("branches", () => {
  it("lists local and remote branches with tracking state", async () => {
    const branches = value(await git.branches(work));
    expect(branches).toEqual([
      expect.objectContaining({ name: "feature", kind: "local", current: false, upstream: null }),
      expect.objectContaining({ name: "main", kind: "local", current: true, upstream: "origin/main", ahead: 1, behind: 0 }),
      expect.objectContaining({ name: "origin/main", kind: "remote" }),
    ]);
  });
});

describe("log", () => {
  it("lists commits newest first with parents and bodies", async () => {
    const commits = value(await git.log(work));
    expect(commits.map((commit) => commit.subject)).toEqual(["Change line 2", "Add lib submodule", "Initial commit"]);
    expect(commits[1]?.body).toBe("Pins the library at its first commit.");
    expect(commits[0]?.parents).toEqual([commits[1]?.hash]);
    expect(commits[2]?.parents).toEqual([]);
    expect(commits[0]).toMatchObject({ authorName: "Pica Fixture", authoredAt: 1700000180 });
  });

  it("honors ref, maxCount, and paths", async () => {
    expect(value(await git.log(work, { maxCount: 1 })).map((c) => c.subject)).toEqual(["Change line 2"]);
    expect(value(await git.log(work, { ref: "feature" }))).toHaveLength(2);
    expect(value(await git.log(work, { paths: ["notes.txt"] })).map((c) => c.subject)).toEqual([
      "Change line 2",
      "Initial commit",
    ]);
  });

  it("returns an empty list for a repository with no commits", async () => {
    const empty = join(root, "empty");
    shell(root, "init", "--quiet", empty);
    expect(await git.log(empty)).toEqual({ ok: true, value: [] });
  });

  it("returns typed errors for bad arguments", async () => {
    expect(errorCode(await git.log(work, { ref: "missing-branch" }))).toBe("git.unknown_revision");
    expect(errorCode(await git.log(work, { ref: "-p" }))).toBe("git.invalid_argument");
    expect(errorCode(await git.log(work, { maxCount: 0 }))).toBe("git.invalid_argument");
  });
});

describe("stage and commit", () => {
  it("commits staged changes and returns the new HEAD", async () => {
    value(await git.stage(work, ["notes.txt", "image.bin"]));
    const { hash } = value(await git.commit(work, { message: "Edit notes\n\nAnd the image." }));
    const [latest] = value(await git.log(work, { maxCount: 1 }));
    expect(latest).toMatchObject({ hash, subject: "Edit notes", body: "And the image.", authorName: "Pica Test" });
    const remaining = value(await git.status(work)).entries.map((entry) => entry.path);
    expect(remaining).not.toContain("notes.txt");
    expect(remaining).not.toContain("doomed.txt");
  });

  it("returns nothing_to_commit when nothing is staged", async () => {
    value(await git.commit(work, { message: "Staged rename and deletion" }));
    expect(errorCode(await git.commit(work, { message: "Again" }))).toBe("git.nothing_to_commit");
    expect(await git.commit(work, { message: "Empty", allowEmpty: true })).toMatchObject({ ok: true });
  });

  it("rejects empty messages and empty path lists", async () => {
    expect(errorCode(await git.commit(work, { message: "  \n" }))).toBe("git.invalid_argument");
    expect(errorCode(await git.stage(work, []))).toBe("git.invalid_argument");
  });

  it("stages deletions of files removed from the working tree", async () => {
    rmSync(join(work, "with space.txt"));
    value(await git.stage(work, ["with space.txt"]));
    const status = value(await git.status(work));
    expect(status.entries).toContainEqual(expect.objectContaining({ path: "with space.txt", index: "deleted" }));
  });
});

describe("push", () => {
  it("fast-forwards an existing branch on a local bare remote", async () => {
    const result = value(await git.push(work, { remote: "origin", branch: "main" }));
    expect(result.refs).toEqual([
      expect.objectContaining({ outcome: "fastForward", remoteRef: "refs/heads/main" }),
    ]);
    expect(value(await git.status(work)).branch).toMatchObject({ ahead: 0, behind: 0 });
  });

  it("creates a new branch and sets its upstream", async () => {
    const result = value(await git.push(work, { remote: "origin", branch: "feature", setUpstream: true }));
    expect(result.refs).toEqual([expect.objectContaining({ outcome: "created", remoteRef: "refs/heads/feature" })]);
    const feature = value(await git.branches(work)).find((branch) => branch.name === "feature");
    expect(feature).toMatchObject({ upstream: "origin/feature", ahead: 0, behind: 0 });
  });

  it("reports up-to-date when there is nothing to send", async () => {
    value(await git.push(work, { remote: "origin", branch: "main" }));
    const again = value(await git.push(work, { remote: "origin", branch: "main" }));
    expect(again.refs).toEqual([expect.objectContaining({ outcome: "upToDate" })]);
  });

  it("returns push_rejected for a non-fast-forward push", async () => {
    const other = join(root, "other");
    shell(root, "clone", "--quiet", join(root, "fixtures/remote.git"), other);
    writeFileSync(join(other, "other.txt"), "from another clone\n");
    shell(other, "add", "other.txt");
    shell(other, "commit", "--quiet", "-m", "Diverge");
    shell(other, "push", "--quiet", "origin", "main");

    const result = await git.push(work, { remote: "origin", branch: "main" });
    expect(errorCode(result)).toBe("git.push_rejected");
    expect(result.ok ? "" : result.error.message).toContain("refs/heads/main");
  });

  it("returns command_failed for an unknown remote and invalid_argument for option-like names", async () => {
    expect(errorCode(await git.push(work, { remote: "nowhere", branch: "main" }))).toBe("git.command_failed");
    expect(errorCode(await git.push(work, { remote: "--mirror", branch: "main" }))).toBe("git.invalid_argument");
  });
});
