import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { changeSetDiffs, changeSetWriteRoots, createChangeSet } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitCliService, createGitWorktreeService } from "../../src/index.ts";
import { commitAll, gitEnv, shell, value } from "../worktrees/fixture.ts";
import { makeChangeSetFixture, type ChangeSetFixture } from "./fixture.ts";

let fixture: ChangeSetFixture;
const worktrees = createGitWorktreeService({ env: gitEnv, now: () => 0 });
const git = createGitCliService({ env: gitEnv });

beforeEach(() => {
  fixture = makeChangeSetFixture();
});

afterEach(() => {
  fixture.cleanup();
});

describe("createChangeSet (R-10)", () => {
  it("creates two worktrees and two branches with the same name", async () => {
    const changeSet = value(await createChangeSet(worktrees, { slug: "rename-user-id", repos: fixture.repos }));

    expect(changeSet.branch).toBe("pica/rename-user-id");
    expect(changeSet.members).toHaveLength(2);
    for (const [index, member] of changeSet.members.entries()) {
      const repo = fixture.repos[index];
      expect(member.repo).toBe(repo?.repo);
      expect(member.worktree.branch).toBe("pica/rename-user-id");
      expect(shell(member.worktree.path, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("pica/rename-user-id");
      expect(shell(member.repo, "branch", "--list", "--format=%(refname:short)", "pica/*").trim()).toBe("pica/rename-user-id");
      expect(member.baseCommit).toBe(shell(member.repo, "rev-parse", "main").trim());
    }
    expect(new Set(changeSetWriteRoots(changeSet)).size).toBe(2);
    expect(changeSetWriteRoots(changeSet)).toEqual(changeSet.members.map((member) => member.worktree.path));
  });

  it("reports the worktrees already made when a later repository fails", async () => {
    shell(fixture.repos[1]?.repo ?? "", "branch", "pica/taken");
    const result = await createChangeSet(worktrees, { slug: "taken", repos: fixture.repos });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "worktree.branch_exists", failedRepo: fixture.repos[1]?.repo });
    expect(result.error.created.map((member) => member.repo)).toEqual([fixture.repos[0]?.repo]);
  });

  it("refuses an invalid slug and a repository listed twice before touching git", async () => {
    const bad = await createChangeSet(worktrees, { slug: "Bad Slug", repos: fixture.repos });
    expect(bad.ok ? undefined : bad.error.code).toBe("worktree.invalid_slug");

    const first = fixture.repos[0];
    if (first === undefined) throw new Error("fixture has no repos");
    const twice = await createChangeSet(worktrees, { slug: "twice", repos: [first, { ...first, worktreePath: "/x" }] });
    expect(twice.ok ? undefined : twice.error.code).toBe("changeset.duplicate_repo");
    expect(shell(first.repo, "branch", "--list", "--format=%(refname:short)", "pica/*").trim()).toBe("");
  });
});

describe("changeSetDiffs (R-10)", () => {
  it("reports each repository's committed changes separately", async () => {
    const changeSet = value(await createChangeSet(worktrees, { slug: "per-repo", repos: fixture.repos }));
    const [api, web] = changeSet.members;
    if (api === undefined || web === undefined) throw new Error("expected two members");
    writeFileSync(join(api.worktree.path, "server.ts"), "export {};\n");
    commitAll(api.worktree.path, "Add server", 1_700_000_100);
    writeFileSync(join(web.worktree.path, "README.md"), "web, changed\n");
    commitAll(web.worktree.path, "Edit readme", 1_700_000_200);

    const diffs = await changeSetDiffs(git, changeSet);
    expect(
      diffs.map((diff) => [diff.repo, diff.ok ? diff.files.map((file) => [file.change, file.path]) : diff.error.code]),
    ).toEqual([
      [api.repo, [["added", "server.ts"]]],
      [web.repo, [["modified", "README.md"]]],
    ]);
  });
});
