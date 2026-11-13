import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeService } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitCliService, createGitWorktreeService } from "../../src/index.ts";
import { errorCode, gitEnv, makeWorktreeFixture, shell, value, type WorktreeFixture } from "./fixture.ts";

let fixture: WorktreeFixture;
let worktrees: WorktreeService;

beforeEach(() => {
  fixture = makeWorktreeFixture();
  worktrees = createGitWorktreeService({ env: gitEnv, now: () => 0 });
});

afterEach(() => {
  fixture.cleanup();
});

describe("create and list", () => {
  it("creates a worktree on a pica/<slug> branch and lists it after the main worktree", async () => {
    const created = value(await worktrees.create(fixture.repo, { slug: "fix-login", path: fixture.path("fix-login") }));
    expect(created).toMatchObject({ branch: "pica/fix-login", main: false, locked: false, prunable: false });
    expect(realpathSync(created.path)).toBe(realpathSync(fixture.path("fix-login")));

    const listed = value(await worktrees.list(fixture.repo));
    expect(listed.map((worktree) => [worktree.branch, worktree.main])).toEqual([
      ["main", true],
      ["pica/fix-login", false],
    ]);
    expect(listed[1]?.head).toBe(listed[0]?.head);
  });

  it("starts the branch from the given base", async () => {
    shell(fixture.repo, "branch", "older");
    writeFileSync(join(fixture.repo, "later.txt"), "later\n");
    shell(fixture.repo, "add", "later.txt");
    shell(fixture.repo, "commit", "--quiet", "-m", "Later");
    const created = value(
      await worktrees.create(fixture.repo, { slug: "from-older", path: fixture.path("older"), base: "older" }),
    );
    expect(created.head).toBe(shell(fixture.repo, "rev-parse", "older").trim());
    expect(existsSync(join(created.path, "later.txt"))).toBe(false);
  });

  it("refuses invalid slugs, existing branches, existing paths, relative paths, and unknown bases", async () => {
    expect(errorCode(await worktrees.create(fixture.repo, { slug: "Bad Slug", path: fixture.path("a") }))).toBe(
      "worktree.invalid_slug",
    );
    expect(errorCode(await worktrees.create(fixture.repo, { slug: "a--b", path: fixture.path("a") }))).toBe(
      "worktree.invalid_slug",
    );
    value(await worktrees.create(fixture.repo, { slug: "taken", path: fixture.path("taken") }));
    expect(errorCode(await worktrees.create(fixture.repo, { slug: "taken", path: fixture.path("other") }))).toBe(
      "worktree.branch_exists",
    );
    expect(errorCode(await worktrees.create(fixture.repo, { slug: "fresh", path: fixture.repo }))).toBe(
      "worktree.path_exists",
    );
    expect(errorCode(await worktrees.create(fixture.repo, { slug: "fresh", path: "relative/dir" }))).toBe(
      "git.invalid_argument",
    );
    expect(
      errorCode(await worktrees.create(fixture.repo, { slug: "fresh", path: fixture.path("fresh"), base: "nope" })),
    ).toBe("git.unknown_revision");
    expect(existsSync(fixture.path("fresh"))).toBe(false);
  });

  it("returns not_a_repository outside a repository", async () => {
    expect(errorCode(await worktrees.list(fixture.root))).toBe("git.not_a_repository");
  });
});

describe("isolation", () => {
  it("does not show edits made in one worktree in another or in the main worktree", async () => {
    const first = value(await worktrees.create(fixture.repo, { slug: "first", path: fixture.path("first") }));
    const second = value(await worktrees.create(fixture.repo, { slug: "second", path: fixture.path("second") }));

    writeFileSync(join(first.path, "README.md"), "changed in first\n");
    writeFileSync(join(first.path, "new-in-first.txt"), "only here\n");
    shell(first.path, "add", "new-in-first.txt");
    shell(first.path, "commit", "--quiet", "-m", "Work in first");
    writeFileSync(join(first.path, "uncommitted.txt"), "draft\n");

    for (const other of [second.path, fixture.repo]) {
      expect(readFileSync(join(other, "README.md"), "utf8")).toBe("hello\n");
      expect(existsSync(join(other, "new-in-first.txt"))).toBe(false);
      expect(existsSync(join(other, "uncommitted.txt"))).toBe(false);
    }

    const git = createGitCliService({ env: gitEnv });
    expect(value(await git.status(second.path)).entries).toEqual([]);
    expect(value(await git.status(fixture.repo)).entries).toEqual([]);
    expect(value(await git.status(first.path)).entries.map((entry) => entry.path)).toEqual([
      "README.md",
      "uncommitted.txt",
    ]);
    expect(shell(second.path, "rev-parse", "HEAD")).not.toBe(shell(first.path, "rev-parse", "HEAD"));
  });
});
