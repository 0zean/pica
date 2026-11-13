import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeService } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitWorktreeService } from "../../src/index.ts";
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

async function branches(): Promise<(string | null)[]> {
  return value(await worktrees.list(fixture.repo)).map((worktree) => worktree.branch);
}

describe("remove", () => {
  it("removes a clean worktree and keeps its branch", async () => {
    const created = value(await worktrees.create(fixture.repo, { slug: "clean", path: fixture.path("clean") }));
    value(await worktrees.remove(fixture.repo, created.path));
    expect(existsSync(created.path)).toBe(false);
    expect(await branches()).toEqual(["main"]);
    expect(shell(fixture.repo, "branch", "--list", "pica/clean").trim()).toBe("pica/clean");
  });

  it.each([
    ["a modified tracked file", "README.md"],
    ["an untracked file", "scratch.txt"],
  ])("refuses to remove a worktree with %s unless forced", async (_label, file) => {
    const created = value(await worktrees.create(fixture.repo, { slug: "dirty", path: fixture.path("dirty") }));
    writeFileSync(join(created.path, file), "unsaved work\n");

    const refused = await worktrees.remove(fixture.repo, created.path);
    expect(errorCode(refused)).toBe("worktree.dirty");
    expect(existsSync(join(created.path, file))).toBe(true);
    expect(await branches()).toEqual(["main", "pica/dirty"]);

    value(await worktrees.remove(fixture.repo, created.path, { force: true }));
    expect(existsSync(created.path)).toBe(false);
    expect(await branches()).toEqual(["main"]);
  });

  it("refuses a staged change too", async () => {
    const created = value(await worktrees.create(fixture.repo, { slug: "staged", path: fixture.path("staged") }));
    writeFileSync(join(created.path, "staged.txt"), "staged\n");
    shell(created.path, "add", "staged.txt");
    expect(errorCode(await worktrees.remove(fixture.repo, created.path, { force: false }))).toBe("worktree.dirty");
  });

  it("refuses the main worktree and paths that are not worktrees", async () => {
    expect(errorCode(await worktrees.remove(fixture.repo, fixture.repo, { force: true }))).toBe("worktree.is_main");
    expect(errorCode(await worktrees.remove(fixture.repo, fixture.path("missing")))).toBe("worktree.not_found");
    expect(existsSync(join(fixture.repo, "README.md"))).toBe(true);
  });
});
