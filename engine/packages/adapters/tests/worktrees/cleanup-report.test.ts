import { realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeCleanupEntry, WorktreeService } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitWorktreeService } from "../../src/index.ts";
import {
  commitAll,
  errorCode,
  fixtureCommitTime,
  gitEnv,
  makeWorktreeFixture,
  shell,
  value,
  type WorktreeFixture,
} from "./fixture.ts";

const hour = 3_600_000;
const day = 24 * hour;
const start = Date.UTC(2026, 0, 1);

let fixture: WorktreeFixture;
let clock: number;
let worktrees: WorktreeService;

beforeEach(() => {
  fixture = makeWorktreeFixture();
  clock = start;
  worktrees = createGitWorktreeService({ env: gitEnv, now: () => clock });
});

afterEach(() => {
  fixture.cleanup();
});

// Git lists linked worktrees in the order of its own directory names, so compare by branch.
function byBranch<T>(entries: readonly WorktreeCleanupEntry[], pick: (entry: WorktreeCleanupEntry) => T): Record<string, T> {
  return Object.fromEntries(entries.map((entry) => [entry.worktree.branch ?? entry.worktree.path, pick(entry)]));
}

function summary(entry: WorktreeCleanupEntry): Record<string, unknown> {
  return {
    ageMs: entry.ageMs,
    ageSource: entry.ageSource,
    merged: entry.merged,
    dirty: entry.dirty,
    removable: entry.removable,
  };
}

// merged-clean: created at day 0, no new commits.
// unmerged: created at day 1, one commit that main does not have.
// dirty: created at day 2, an uncommitted edit.
// merged-dirty: created at day 3, a commit main has since merged, plus an untracked file.
// external: made with plain git, so its age comes from its last commit.
async function buildFixture(): Promise<void> {
  value(await worktrees.create(fixture.repo, { slug: "merged-clean", path: fixture.path("merged-clean") }));

  clock = start + day;
  const unmerged = value(await worktrees.create(fixture.repo, { slug: "unmerged", path: fixture.path("unmerged") }));
  writeFileSync(join(unmerged.path, "feature.txt"), "feature\n");
  commitAll(unmerged.path, "Unmerged work", fixtureCommitTime + 600);

  clock = start + 2 * day;
  const dirty = value(await worktrees.create(fixture.repo, { slug: "dirty", path: fixture.path("dirty") }));
  writeFileSync(join(dirty.path, "README.md"), "edited\n");

  clock = start + 3 * day;
  const mergedDirty = value(
    await worktrees.create(fixture.repo, { slug: "merged-dirty", path: fixture.path("merged-dirty") }),
  );
  writeFileSync(join(mergedDirty.path, "done.txt"), "done\n");
  commitAll(mergedDirty.path, "Finished work", fixtureCommitTime + 1200);
  shell(fixture.repo, "merge", "--quiet", "--ff-only", "pica/merged-dirty");
  writeFileSync(join(mergedDirty.path, "notes.txt"), "leftover\n");

  shell(fixture.repo, "worktree", "add", "--quiet", "-b", "external", fixture.path("external"));
}

describe("cleanup report", () => {
  it("lists age, merged state, and dirty state for every linked worktree", async () => {
    await buildFixture();
    clock = start + 10 * day;

    const report = value(await worktrees.cleanupReport(fixture.repo));
    expect(report.base).toBe("main");
    expect(report.generatedAt).toBe(start + 10 * day);
    expect(report.entries).toHaveLength(5);
    expect(byBranch(report.entries, summary)).toEqual({
      "pica/merged-clean": { ageMs: 10 * day, ageSource: "created", merged: true, dirty: false, removable: true },
      "pica/unmerged": { ageMs: 9 * day, ageSource: "created", merged: false, dirty: false, removable: false },
      "pica/dirty": { ageMs: 8 * day, ageSource: "created", merged: true, dirty: true, removable: false },
      "pica/merged-dirty": { ageMs: 7 * day, ageSource: "created", merged: true, dirty: true, removable: false },
      external: {
        ageMs: start + 10 * day - (fixtureCommitTime + 1200) * 1000,
        ageSource: "last_commit",
        merged: true,
        dirty: false,
        removable: true,
      },
    });
    const unmerged = report.entries.find((entry) => entry.worktree.branch === "pica/unmerged");
    expect(unmerged?.createdAt).toBe(start + day);
    expect(unmerged?.lastCommitAt).toBe((fixtureCommitTime + 600) * 1000);
    expect(realpathSync(unmerged?.worktree.path ?? "")).toBe(realpathSync(fixture.path("unmerged")));
  });

  it("measures merged state against the base it is given", async () => {
    await buildFixture();
    shell(fixture.repo, "branch", "release", "HEAD~1");
    const report = value(await worktrees.cleanupReport(fixture.repo, { base: "release" }));
    expect(report.base).toBe("release");
    expect(byBranch(report.entries, (entry) => entry.merged)).toEqual({
      "pica/merged-clean": true,
      "pica/unmerged": false,
      "pica/dirty": true,
      "pica/merged-dirty": false,
      external: false,
    });
  });

  it("reports a deleted worktree directory as prunable and not dirty", async () => {
    const created = value(await worktrees.create(fixture.repo, { slug: "gone", path: fixture.path("gone") }));
    rmSync(created.path, { recursive: true, force: true });
    clock = start + hour;
    const [entry] = value(await worktrees.cleanupReport(fixture.repo)).entries;
    expect(entry?.worktree.prunable).toBe(true);
    expect(entry).toMatchObject({ dirty: false, merged: true, ageSource: "last_commit", createdAt: null });
  });

  it("returns an empty report when there are no linked worktrees, and an error for an unknown base", async () => {
    expect(value(await worktrees.cleanupReport(fixture.repo)).entries).toEqual([]);
    value(await worktrees.create(fixture.repo, { slug: "one", path: fixture.path("one") }));
    expect(errorCode(await worktrees.cleanupReport(fixture.repo, { base: "no-such-branch" }))).toBe(
      "git.unknown_revision",
    );
  });
});
