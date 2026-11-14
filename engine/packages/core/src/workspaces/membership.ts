import { ok } from "../result.ts";
import type { Repo, Workspace } from "../store/entities.ts";
import { fromStore, type WorkspaceResult, type WorkspaceServiceDeps } from "./deps.ts";

// Pinned repos first, in pin order, then each source's repos; a repo appears once.
export function memberRepoIds(workspace: Workspace): string[] {
  return [...new Set([...workspace.pinnedRepoIds, ...workspace.sources.flatMap((source) => source.repoIds)])];
}

export function workspaceRepos(deps: WorkspaceServiceDeps, workspace: Workspace): WorkspaceResult<Repo[]> {
  const repos: Repo[] = [];
  for (const id of memberRepoIds(workspace)) {
    const repo = fromStore(deps.repos.get(id), "workspace.repo_not_found");
    if (!repo.ok) return repo;
    repos.push(repo.value);
  }
  return ok(repos);
}

// Drops repos that left a workspace if discovery created them, they were never cloned, and no
// workspace still includes them. Cloned and registered repos stay: removing those is R-03's `repo.remove`.
export function forgetUnused(deps: WorkspaceServiceDeps, candidateIds: readonly string[]): WorkspaceResult<void> {
  if (candidateIds.length === 0) return ok(undefined);
  const workspaces = fromStore(deps.workspaces.list(), "workspace.not_found");
  if (!workspaces.ok) return workspaces;
  const inUse = new Set(workspaces.value.flatMap(memberRepoIds));
  for (const id of candidateIds) {
    if (inUse.has(id)) continue;
    const repo = deps.repos.get(id);
    if (!repo.ok || repo.value.cloneState !== "absent") continue;
    const deleted = fromStore(deps.repos.delete(id), "workspace.repo_not_found");
    if (!deleted.ok) return deleted;
  }
  return ok(undefined);
}

export function departed(before: readonly string[], after: Workspace | null): string[] {
  const remaining = new Set(after === null ? [] : memberRepoIds(after));
  return before.filter((id) => !remaining.has(id));
}
