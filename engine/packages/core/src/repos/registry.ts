import type { GitError } from "../git/errors.ts";
import type { GitService } from "../git/port.ts";
import { err, ok, type Result } from "../result.ts";
import type { Repo } from "../store/entities.ts";
import type { RepoRepository, StoreError } from "../store/ports.ts";
import { repoRegistryError, type RepoLocalWork, type RepoRegistryError } from "./errors.ts";
import type { RepoRegistryDirectories, RepoRegistryGit } from "./ports.ts";
import { isInsideDirectory, managedClonePath, normalizeRemoteUrl, type NormalizedRemote } from "./remote-url.ts";

export interface RepoRegistryDeps {
  readonly repos: RepoRepository;
  readonly git: GitService;
  readonly registryGit: RepoRegistryGit;
  readonly directories: RepoRegistryDirectories;
  readonly managedRoot: string;
  readonly newId: () => string;
}

export interface RemoveRepoOptions {
  readonly force: boolean;
}

export type RepoRegistryResult<T> = Promise<Result<T, RepoRegistryError>>;

export interface RepoRegistry {
  addByPath(path: string): RepoRegistryResult<Repo>;
  addByUrl(url: string): RepoRegistryResult<Repo>;
  remove(id: string, options: RemoveRepoOptions): RepoRegistryResult<void>;
  list(): Result<readonly Repo[], RepoRegistryError>;
}

const originRemote = "origin";

export function createRepoRegistry(deps: RepoRegistryDeps): RepoRegistry {
  return {
    addByPath: (path) => addByPath(deps, path),
    addByUrl: (url) => addByUrl(deps, url),
    remove: (id, options) => remove(deps, id, options),
    list: () => fromStore(deps.repos.list()),
  };
}

// A path whose remote is already registered resolves to that Repo; the Repo's own path wins.
async function addByPath(deps: RepoRegistryDeps, path: string): RepoRegistryResult<Repo> {
  const topLevel = fromGit(await deps.registryGit.topLevel(path));
  if (!topLevel.ok) return topLevel;
  const localPath = topLevel.value;
  const remoteUrl = fromGit(await deps.registryGit.remoteUrl(localPath, originRemote));
  if (!remoteUrl.ok) return remoteUrl;
  if (remoteUrl.value === null) {
    return err(repoRegistryError("repo.no_remote", `${localPath} has no "${originRemote}" remote`));
  }
  const remote = normalizeRemoteUrl(remoteUrl.value);
  if (!remote.ok) return remote;
  const existing = findExisting(deps, remote.value);
  if (!existing.ok) return existing;
  if (existing.value !== null && existing.value.localPath !== null) return ok(existing.value);
  const defaultBranch = fromGit(await deps.registryGit.defaultBranch(localPath));
  if (!defaultBranch.ok) return defaultBranch;
  return save(deps, {
    id: existing.value?.id ?? deps.newId(),
    remoteUrl: remote.value.url,
    localPath,
    managed: false,
    defaultBranch: defaultBranch.value,
    cloneState: "ready",
  });
}

async function addByUrl(deps: RepoRegistryDeps, url: string): RepoRegistryResult<Repo> {
  const remote = normalizeRemoteUrl(url);
  if (!remote.ok) return remote;
  const existing = findExisting(deps, remote.value);
  if (!existing.ok) return existing;
  if (existing.value !== null && existing.value.cloneState === "ready" && existing.value.localPath !== null) {
    return ok(existing.value);
  }
  const destination = managedClonePath(deps.managedRoot, remote.value);
  if (await deps.directories.exists(destination)) {
    return err(repoRegistryError("repo.path_exists", `${destination} already exists; add it by path instead`));
  }
  const cloning = save(deps, {
    id: existing.value?.id ?? deps.newId(),
    remoteUrl: remote.value.url,
    localPath: destination,
    managed: true,
    defaultBranch: null,
    cloneState: "cloning",
  });
  if (!cloning.ok) return cloning;
  return finishClone(deps, cloning.value, url.trim(), destination);
}

async function finishClone(deps: RepoRegistryDeps, repo: Repo, url: string, destination: string): RepoRegistryResult<Repo> {
  const cloned = await deps.registryGit.partialClone(url, destination);
  const defaultBranch = cloned.ok ? await deps.registryGit.defaultBranch(destination) : cloned;
  if (!defaultBranch.ok) {
    await deps.directories.removeTree(destination);
    save(deps, { ...repo, cloneState: "failed" });
    return err(repoRegistryError("repo.clone_failed", `could not clone ${url}: ${defaultBranch.error.message}`, defaultBranch.error));
  }
  return save(deps, { ...repo, defaultBranch: defaultBranch.value, cloneState: "ready" });
}

// Unmanaged repos belong to the developer: removing one forgets it and touches nothing on disk.
async function remove(deps: RepoRegistryDeps, id: string, options: RemoveRepoOptions): RepoRegistryResult<void> {
  const repo = fromStore(deps.repos.get(id));
  if (!repo.ok) return repo;
  const clonePath = repo.value.managed ? repo.value.localPath : null;
  if (clonePath === null) {
    return fromStore(deps.repos.delete(id));
  }
  if (!isInsideDirectory(clonePath, deps.managedRoot)) {
    return err(repoRegistryError("repo.outside_managed_root", `${clonePath} is not inside ${deps.managedRoot}; refusing to delete it`));
  }
  const present = await deps.directories.exists(clonePath);
  if (present && !options.force) {
    const refused = await refuseLocalWork(deps, clonePath);
    if (refused !== undefined) return err(refused);
  }
  const forgotten = fromStore(deps.repos.delete(id));
  if (!forgotten.ok || !present) return forgotten;
  const removed = await deps.directories.removeTree(clonePath);
  return removed.ok
    ? ok(undefined)
    : err(repoRegistryError("repo.filesystem_failed", `could not delete ${clonePath}: ${removed.error.message}`, removed.error));
}

async function refuseLocalWork(deps: RepoRegistryDeps, clonePath: string): Promise<RepoRegistryError | undefined> {
  const work = await localWork(deps, clonePath);
  if (!work.ok) return work.error;
  const { uncommittedPaths, unpushedCommits } = work.value;
  if (uncommittedPaths.length === 0 && unpushedCommits === 0) return undefined;
  const message =
    `${clonePath} has ${String(uncommittedPaths.length)} uncommitted path(s) and ` +
    `${String(unpushedCommits)} unpushed commit(s); remove it with force to discard them`;
  return { ...repoRegistryError("repo.has_local_work", message), localWork: work.value };
}

async function localWork(deps: RepoRegistryDeps, clonePath: string): Promise<Result<RepoLocalWork, RepoRegistryError>> {
  const status = fromGit(await deps.git.status(clonePath));
  if (!status.ok) return status;
  const unpushed = fromGit(await deps.registryGit.unpushedCommitCount(clonePath));
  if (!unpushed.ok) return unpushed;
  const uncommittedPaths = status.value.entries.filter((entry) => entry.kind !== "ignored").map((entry) => entry.path);
  return ok({ uncommittedPaths, unpushedCommits: unpushed.value });
}

function findExisting(deps: RepoRegistryDeps, remote: NormalizedRemote): Result<Repo | null, RepoRegistryError> {
  const found = deps.repos.findByRemoteUrl(remote.url);
  if (found.ok) return found;
  return found.error.code === "store.not_found" ? ok(null) : fromStore(found);
}

function save(deps: RepoRegistryDeps, repo: Repo): Result<Repo, RepoRegistryError> {
  const saved = fromStore(deps.repos.save(repo));
  return saved.ok ? ok(repo) : saved;
}

function fromStore<T>(result: Result<T, StoreError>): Result<T, RepoRegistryError> {
  if (result.ok) return result;
  const code = result.error.code === "store.not_found" ? "repo.not_found" : "repo.store_failed";
  return err(repoRegistryError(code, result.error.message, result.error));
}

function fromGit<T>(result: Result<T, GitError>): Result<T, RepoRegistryError> {
  return result.ok ? result : err(repoRegistryError("repo.git_failed", result.error.message, result.error));
}
