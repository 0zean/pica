import type { DiscoveredRepo } from "../discovery/model.ts";
import { selectorForSource } from "../discovery/selectors.ts";
import { syncRepoSource } from "../discovery/sync.ts";
import type { DiscoveryError } from "../discovery/errors.ts";
import { err, ok } from "../result.ts";
import type { Repo, RepoSource } from "../store/entities.ts";
import { fromStore, loadWorkspace, saveWorkspace, type WorkspaceResult, type WorkspaceServiceDeps } from "./deps.ts";
import { workspaceError } from "./errors.ts";
import { departed, forgetUnused, memberRepoIds } from "./membership.ts";

export interface WorkspaceSync {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

// Revalidates every discoverable source and reports which repos joined and left the workspace.
// Nothing is saved unless every source syncs.
export async function syncWorkspace(deps: WorkspaceServiceDeps, workspaceId: string): Promise<WorkspaceResult<WorkspaceSync>> {
  const workspace = loadWorkspace(deps, workspaceId);
  if (!workspace.ok) return workspace;
  const now = deps.clock();
  const sources: RepoSource[] = [];
  for (const source of workspace.value.sources) {
    const synced = await syncSource(deps, source, now);
    if (!synced.ok) return synced;
    sources.push(synced.value);
  }
  const saved = saveWorkspace(deps, { ...workspace.value, sources });
  if (!saved.ok) return saved;
  const before = memberRepoIds(workspace.value);
  const removed = departed(before, saved.value);
  const forgotten = forgetUnused(deps, removed);
  if (!forgotten.ok) return forgotten;
  const added = memberRepoIds(saved.value).filter((id) => !before.includes(id));
  return ok({ added, removed });
}

export async function syncSource(deps: WorkspaceServiceDeps, source: RepoSource, now: string): Promise<WorkspaceResult<RepoSource>> {
  if (source.kind === "manual") return ok(source);
  const selector = selectorForSource(source);
  if (!selector.ok) return discoveryFailed(selector.error);
  const client = await deps.discovery.client(selector.value.org);
  if (!client.ok) return discoveryFailed(client.error);
  const synced = await syncRepoSource(client.value, selector.value, source.snapshot, { filter: deps.discovery.filter, now });
  if (!synced.ok) return discoveryFailed(synced.error);
  const repoIds: string[] = [];
  for (const discovered of synced.value.repos) {
    const repo = availableRepo(deps, discovered);
    if (!repo.ok) return repo;
    repoIds.push(repo.value.id);
  }
  return ok({ ...source, snapshot: synced.value.snapshot, repoIds, lastSyncAt: now });
}

// A repo already registered (cloned, or added by path) is reused; a new one is recorded as available.
function availableRepo(deps: WorkspaceServiceDeps, discovered: DiscoveredRepo): WorkspaceResult<Repo> {
  const found = deps.repos.findByRemoteUrl(discovered.remoteUrl);
  if (found.ok || found.error.code !== "store.not_found") return fromStore(found, "workspace.repo_not_found");
  const repo: Repo = {
    id: deps.newId(),
    remoteUrl: discovered.remoteUrl,
    localPath: null,
    managed: true,
    defaultBranch: discovered.defaultBranch,
    cloneState: "absent",
  };
  const saved = fromStore(deps.repos.save(repo), "workspace.repo_not_found");
  return saved.ok ? ok(repo) : saved;
}

// PLAN.md §6: a repo is cloned the first time it is used.
export async function ensureCloned(deps: WorkspaceServiceDeps, repoId: string): Promise<WorkspaceResult<Repo>> {
  const repo = fromStore(deps.repos.get(repoId), "workspace.repo_not_found");
  if (!repo.ok || repo.value.cloneState === "ready") return repo;
  const cloned = await deps.clone(repo.value.remoteUrl);
  return cloned.ok ? cloned : err(workspaceError("workspace.clone_failed", cloned.error.message));
}

function discoveryFailed(error: DiscoveryError): WorkspaceResult<never> {
  return err({ code: "workspace.discovery_failed", message: error.message, discovery: error });
}
