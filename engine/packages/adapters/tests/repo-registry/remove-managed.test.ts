import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Repo } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRegistryFixture, git, makeBareRemote, value, type RegistryFixture } from "./helpers.ts";

describe("removing a managed clone", () => {
  let fixture: RegistryFixture;
  let clone: Repo;
  let clonePath: string;

  beforeEach(async () => {
    fixture = createRegistryFixture();
    const bare = makeBareRemote(fixture.root, "acme", "widget");
    clone = value(await fixture.registry.addByUrl(`file://${bare}`));
    clonePath = clone.localPath ?? "";
  });

  afterEach(() => {
    fixture.dispose();
  });

  function refusal(result: Awaited<ReturnType<typeof fixture.registry.remove>>) {
    return result.ok ? undefined : result.error;
  }

  function expectStillRegistered(): void {
    expect(existsSync(clonePath)).toBe(true);
    expect(value(fixture.registry.list())).toEqual([clone]);
  }

  it("clones by URL as a partial clone into the managed directory", () => {
    expect(clone).toMatchObject({ managed: true, cloneState: "ready", defaultBranch: "main" });
    expect(clonePath).toBe(join(fixture.managedRoot, "acme/widget"));
    expect(git(clonePath, "config", "remote.origin.partialclonefilter")).toBe("blob:none");
    expect(git(clonePath, "config", "remote.origin.promisor")).toBe("true");
  });

  it("deletes a clean clone without force", async () => {
    value(await fixture.registry.remove(clone.id, { force: false }));
    expect(existsSync(clonePath)).toBe(false);
    expect(value(fixture.registry.list())).toEqual([]);
  });

  it("refuses a clone with a modified file, then deletes it with force", async () => {
    writeFileSync(join(clonePath, "src.txt"), "changed\n");

    expect(refusal(await fixture.registry.remove(clone.id, { force: false }))).toMatchObject({
      code: "repo.has_local_work",
      localWork: { uncommittedPaths: ["src.txt"], unpushedCommits: 0 },
    });
    expectStillRegistered();

    value(await fixture.registry.remove(clone.id, { force: true }));
    expect(existsSync(clonePath)).toBe(false);
  });

  it("refuses a clone with an untracked file", async () => {
    writeFileSync(join(clonePath, "notes.txt"), "draft\n");
    expect(refusal(await fixture.registry.remove(clone.id, { force: false }))).toMatchObject({
      code: "repo.has_local_work",
      localWork: { uncommittedPaths: ["notes.txt"] },
    });
    expectStillRegistered();
  });

  it("refuses a clone with an unpushed commit on the current branch, then deletes it with force", async () => {
    git(clonePath, "commit", "--quiet", "--allow-empty", "-m", "Local only");

    expect(refusal(await fixture.registry.remove(clone.id, { force: false }))).toMatchObject({
      code: "repo.has_local_work",
      localWork: { uncommittedPaths: [], unpushedCommits: 1 },
    });
    expectStillRegistered();

    value(await fixture.registry.remove(clone.id, { force: true }));
    expect(existsSync(clonePath)).toBe(false);
    expect(value(fixture.registry.list())).toEqual([]);
  });

  it("refuses a clone with an unpushed commit on a branch that is not checked out", async () => {
    git(clonePath, "switch", "--quiet", "-c", "side");
    git(clonePath, "commit", "--quiet", "--allow-empty", "-m", "Side work");
    git(clonePath, "switch", "--quiet", "main");

    expect(refusal(await fixture.registry.remove(clone.id, { force: false }))).toMatchObject({
      code: "repo.has_local_work",
      localWork: { unpushedCommits: 1 },
    });
    expectStillRegistered();
  });

  it("deletes a clone whose commits have all been pushed", async () => {
    git(clonePath, "commit", "--quiet", "--allow-empty", "-m", "Shared");
    git(clonePath, "push", "--quiet", "origin", "main");

    value(await fixture.registry.remove(clone.id, { force: false }));
    expect(existsSync(clonePath)).toBe(false);
  });

  it("returns the existing clone when the same remote is added again", async () => {
    const bare = join(fixture.root, "remotes/acme/widget.git");
    expect(value(await fixture.registry.addByUrl(`file://${bare}`))).toEqual(clone);
    expect(value(fixture.registry.list())).toHaveLength(1);
  });

  it("leaves no directory behind when a clone fails, and the failed Repo can be removed", async () => {
    const result = await fixture.registry.addByUrl(`file://${join(fixture.root, "remotes/acme/missing.git")}`);
    expect(result.ok ? undefined : result.error.code).toBe("repo.clone_failed");
    expect(existsSync(join(fixture.managedRoot, "acme/missing"))).toBe(false);
    const failed = value(fixture.registry.list()).find((repo) => repo.cloneState === "failed");
    value(await fixture.registry.remove(failed?.id ?? "", { force: false }));
    expect(value(fixture.registry.list())).toEqual([clone]);
  });
});
