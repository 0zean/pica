import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoRegistryDeps } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRegistryFixture, git, makeLocalRepo, snapshotTree, value, type RegistryFixture } from "./helpers.ts";

// Records every filesystem and git call the registry makes, so the test can prove there were none.
function recording(calls: string[]) {
  return (deps: RepoRegistryDeps): RepoRegistryDeps => {
    const { git: service, registryGit: ops, directories } = deps;
    const noted =
      <A extends unknown[], R>(name: string, call: (...args: A) => R) =>
      (...args: A): R => {
        calls.push(name);
        return call(...args);
      };
    return {
      ...deps,
      git: {
        status: noted("git.status", (repo) => service.status(repo)),
        diff: noted("git.diff", (repo, target, paths) => service.diff(repo, target, paths)),
        branches: noted("git.branches", (repo) => service.branches(repo)),
        log: noted("git.log", (repo, options) => service.log(repo, options)),
        stage: noted("git.stage", (repo, paths) => service.stage(repo, paths)),
        commit: noted("git.commit", (repo, options) => service.commit(repo, options)),
        push: noted("git.push", (repo, options) => service.push(repo, options)),
      },
      registryGit: {
        topLevel: noted("registryGit.topLevel", (path) => ops.topLevel(path)),
        remoteUrl: noted("registryGit.remoteUrl", (repo, remote) => ops.remoteUrl(repo, remote)),
        defaultBranch: noted("registryGit.defaultBranch", (repo) => ops.defaultBranch(repo)),
        partialClone: noted("registryGit.partialClone", (url, destination) => ops.partialClone(url, destination)),
        unpushedCommitCount: noted("registryGit.unpushedCommitCount", (repo) => ops.unpushedCommitCount(repo)),
      },
      directories: {
        exists: noted("directories.exists", (path) => directories.exists(path)),
        removeTree: noted("directories.removeTree", (path) => directories.removeTree(path)),
      },
    };
  };
}

describe("removing an unmanaged repo", () => {
  let fixture: RegistryFixture;
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    fixture = createRegistryFixture(recording(calls));
  });

  afterEach(() => {
    fixture.dispose();
  });

  async function addDirtyCheckout(path: string): Promise<string> {
    const checkout = makeLocalRepo(path, "git@github.com:acme/widget.git");
    git(checkout, "commit", "--quiet", "--allow-empty", "-m", "Unpushed");
    writeFileSync(join(checkout, "README.md"), "edited\n");
    writeFileSync(join(checkout, "untracked.txt"), "new\n");
    return value(await fixture.registry.addByPath(checkout)).id;
  }

  it.each([false, true])("forgets the Repo and leaves the checkout untouched (force: %s)", async (force) => {
    const checkout = join(fixture.root, "work/widget");
    const id = await addDirtyCheckout(checkout);
    const before = snapshotTree(checkout);
    calls.length = 0;

    value(await fixture.registry.remove(id, { force }));

    expect(calls).toEqual([]);
    expect(snapshotTree(checkout)).toEqual(before);
    expect(value(fixture.registry.list())).toEqual([]);
  });

  it("leaves an unmanaged checkout untouched even when it sits inside the managed directory", async () => {
    const checkout = join(fixture.managedRoot, "acme/widget");
    const id = await addDirtyCheckout(checkout);
    const before = snapshotTree(fixture.managedRoot);
    calls.length = 0;

    value(await fixture.registry.remove(id, { force: true }));

    expect(calls).toEqual([]);
    expect(snapshotTree(fixture.managedRoot)).toEqual(before);
  });

  it("reports an unknown id without touching anything", async () => {
    const result = await fixture.registry.remove("missing", { force: true });
    expect(result.ok ? undefined : result.error.code).toBe("repo.not_found");
    expect(calls).toEqual([]);
  });
});
