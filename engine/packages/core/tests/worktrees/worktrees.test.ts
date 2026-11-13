import { describe, expect, it } from "vitest";
import {
  buildWorktreeCleanupReport,
  parseWorktreeList,
  worktreeBranchName,
  type WorktreeFacts,
  type WorktreeInfo,
} from "../../src/index.ts";

const sha1 = "1".repeat(40);
const sha2 = "2".repeat(40);

describe("worktreeBranchName", () => {
  it("prefixes valid slugs with pica/", () => {
    expect(worktreeBranchName("fix-login-2")).toEqual({ ok: true, value: "pica/fix-login-2" });
  });

  it.each(["", "Fix", "a--b", "-a", "a-", "a/b", "a b", "a.b", "x".repeat(65)])('rejects "%s"', (slug) => {
    const result = worktreeBranchName(slug);
    expect(result.ok ? undefined : result.error.code).toBe("worktree.invalid_slug");
  });
});

describe("parseWorktreeList", () => {
  it("reads main, branch, detached, locked, prunable, and unborn worktrees", () => {
    const raw = [
      `worktree /repo\0HEAD ${sha1}\0branch refs/heads/main\0\0`,
      `worktree /wt/a b\0HEAD ${sha2}\0branch refs/heads/pica/a\0locked\0\0`,
      `worktree /wt/detached\0HEAD ${sha1}\0detached\0prunable gitdir file points to non-existent location\0\0`,
      `worktree /wt/unborn\0HEAD ${"0".repeat(40)}\0branch refs/heads/pica/new\0locked reason here\0\0`,
    ].join("");
    expect(parseWorktreeList(raw)).toEqual({
      ok: true,
      value: [
        { path: "/repo", head: sha1, branch: "main", main: true, bare: false, locked: false, prunable: false },
        { path: "/wt/a b", head: sha2, branch: "pica/a", main: false, bare: false, locked: true, prunable: false },
        { path: "/wt/detached", head: sha1, branch: null, main: false, bare: false, locked: false, prunable: true },
        { path: "/wt/unborn", head: null, branch: "pica/new", main: false, bare: false, locked: true, prunable: false },
      ],
    });
  });

  it("reads a bare main repository", () => {
    const parsed = parseWorktreeList("worktree /repo.git\0bare\0\0");
    expect(parsed.ok && parsed.value[0]).toMatchObject({ bare: true, main: true, head: null, branch: null });
  });

  it("returns an empty list for empty output", () => {
    expect(parseWorktreeList("")).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["a record without a path", `HEAD ${sha1}\0\0`],
    ["a bad commit", "worktree /a\0HEAD xyz\0\0"],
    ["a branch outside refs/heads", "worktree /a\0branch refs/tags/v1\0\0"],
  ])("fails on %s", (_label, raw) => {
    const parsed = parseWorktreeList(raw);
    expect(parsed.ok ? undefined : parsed.error.code).toBe("git.parse_failed");
  });
});

describe("buildWorktreeCleanupReport", () => {
  const worktree: WorktreeInfo = {
    path: "/wt/a",
    head: sha1,
    branch: "pica/a",
    main: false,
    bare: false,
    locked: false,
    prunable: false,
  };
  const facts = (overrides: Partial<WorktreeFacts>): WorktreeFacts => ({
    worktree,
    createdAt: 1_000,
    lastCommitAt: 500,
    merged: true,
    dirty: false,
    ...overrides,
  });

  it("ages from creation time, else from the last commit, else not at all", () => {
    const report = buildWorktreeCleanupReport(
      "main",
      [facts({}), facts({ createdAt: null }), facts({ createdAt: null, lastCommitAt: null }), facts({ createdAt: 9_000 })],
      5_000,
    );
    expect(report.generatedAt).toBe(5_000);
    expect(report.base).toBe("main");
    expect(report.entries.map((entry) => [entry.ageMs, entry.ageSource])).toEqual([
      [4_000, "created"],
      [4_500, "last_commit"],
      [null, "unknown"],
      [0, "created"],
    ]);
  });

  it("marks only merged, clean, unlocked worktrees removable", () => {
    const locked = { ...worktree, locked: true };
    const report = buildWorktreeCleanupReport(
      "main",
      [facts({}), facts({ merged: false }), facts({ dirty: true }), facts({ worktree: locked })],
      5_000,
    );
    expect(report.entries.map((entry) => entry.removable)).toEqual([true, false, false, false]);
  });
});
