import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepoRegistry, type RepoRegistry, type RepoRegistryDeps, type Result, type Store } from "@pica/core";
import { createGitCliService, createGitRepoRegistryOps, createRepoDirectories, openSqliteStore } from "../../src/index.ts";

export const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Pica Test",
  GIT_AUTHOR_EMAIL: "test@pica.test",
  GIT_COMMITTER_NAME: "Pica Test",
  GIT_COMMITTER_EMAIL: "test@pica.test",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: "pipe" }).trim();
}

export interface RegistryFixture {
  readonly root: string;
  readonly managedRoot: string;
  readonly store: Store;
  readonly deps: RepoRegistryDeps;
  readonly registry: RepoRegistry;
  dispose(): void;
}

export function createRegistryFixture(wrap: (deps: RepoRegistryDeps) => RepoRegistryDeps = (deps) => deps): RegistryFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pica-registry-")));
  const managedRoot = join(root, "managed");
  const store = value(openSqliteStore(join(root, "pica.db")));
  let next = 0;
  const deps = wrap({
    repos: store.repos,
    git: createGitCliService({ env: gitEnv }),
    registryGit: createGitRepoRegistryOps({ env: gitEnv }),
    directories: createRepoDirectories(),
    managedRoot,
    newId: () => `repo-${String((next += 1))}`,
  });
  return {
    root,
    managedRoot,
    store,
    deps,
    registry: createRepoRegistry(deps),
    dispose: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// A repository with one commit and the given origin URL. Nothing here talks to the remote.
export function makeLocalRepo(path: string, origin: string | null): string {
  mkdirSync(path, { recursive: true });
  git(path, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(path, "README.md"), "hello\n");
  git(path, "add", "README.md");
  git(path, "commit", "--quiet", "-m", "Initial commit");
  if (origin !== null) git(path, "remote", "add", "origin", origin);
  return path;
}

// A bare repository that serves partial clones over file://, seeded with one commit on main.
export function makeBareRemote(root: string, org: string, name: string): string {
  const bare = join(root, "remotes", org, `${name}.git`);
  mkdirSync(bare, { recursive: true });
  git(bare, "init", "--quiet", "--bare", "--initial-branch=main");
  git(bare, "config", "uploadpack.allowFilter", "true");
  const seed = makeLocalRepo(join(root, "seed", org, name), bare);
  writeFileSync(join(seed, "src.txt"), "source\n");
  git(seed, "add", "src.txt");
  git(seed, "commit", "--quiet", "-m", "Add source");
  git(seed, "push", "--quiet", "origin", "main");
  return bare;
}

// Every entry under `dir` with its kind, size, mtime and content hash.
export function snapshotTree(dir: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
    const path = join(dir, entry);
    const info = statSync(path);
    const hash = info.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : "dir";
    snapshot[entry] = `${hash} ${String(info.size)} ${String(info.mtimeMs)}`;
  }
  return snapshot;
}

export function value<T, E extends { readonly message: string }>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
