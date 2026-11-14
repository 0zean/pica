import { validateLayer } from "../config/validate.ts";
import { selectorForSource } from "../discovery/selectors.ts";
import type { JsonObject } from "../json.ts";
import { err, ok } from "../result.ts";
import type { Repo, RepoSource, RepoSourceKind, Workspace } from "../store/entities.ts";
import { fromStore, loadWorkspace, saveWorkspace, type WorkspaceResult, type WorkspaceServiceDeps } from "./deps.ts";
import { workspaceError } from "./errors.ts";
import { departed, forgetUnused, memberRepoIds, workspaceRepos } from "./membership.ts";
import { ensureCloned, syncWorkspace, type WorkspaceSync } from "./sync.ts";

export interface WorkspaceChanges {
  readonly name?: string | undefined;
  readonly settingsOverrides?: JsonObject | undefined;
}

export interface NewRepoSource {
  readonly kind: RepoSourceKind;
  readonly org: string | null;
  readonly selector: string;
}

export interface WorkspaceService {
  list(): WorkspaceResult<readonly Workspace[]>;
  get(id: string): WorkspaceResult<Workspace>;
  create(name: string): WorkspaceResult<Workspace>;
  update(id: string, changes: WorkspaceChanges): WorkspaceResult<Workspace>;
  delete(id: string): WorkspaceResult<void>;
  addSource(workspaceId: string, source: NewRepoSource): WorkspaceResult<RepoSource>;
  removeSource(workspaceId: string, sourceId: string): WorkspaceResult<void>;
  pinRepo(workspaceId: string, repoId: string): WorkspaceResult<void>;
  unpinRepo(workspaceId: string, repoId: string): WorkspaceResult<void>;
  // Without a workspace, every registered repo.
  repos(workspaceId?: string): WorkspaceResult<readonly Repo[]>;
  repo(id: string): WorkspaceResult<Repo>;
  sync(workspaceId: string): Promise<WorkspaceResult<WorkspaceSync>>;
  ensureCloned(repoId: string): Promise<WorkspaceResult<Repo>>;
}

export function createWorkspaceService(deps: WorkspaceServiceDeps): WorkspaceService {
  return {
    list: () => fromStore(deps.workspaces.list(), "workspace.not_found"),
    get: (id) => loadWorkspace(deps, id),
    create: (name) => {
      const trimmed = validName(name);
      if (!trimmed.ok) return trimmed;
      return saveWorkspace(deps, { id: deps.newId(), name: trimmed.value, sources: [], pinnedRepoIds: [], settingsOverrides: {} });
    },
    update: (id, changes) => update(deps, id, changes),
    delete: (id) => remove(deps, id),
    addSource: (workspaceId, source) => addSource(deps, workspaceId, source),
    removeSource: (workspaceId, sourceId) => removeSource(deps, workspaceId, sourceId),
    pinRepo: (workspaceId, repoId) => pinRepo(deps, workspaceId, repoId),
    unpinRepo: (workspaceId, repoId) =>
      replace(deps, workspaceId, (workspace) => ({
        ...workspace,
        pinnedRepoIds: workspace.pinnedRepoIds.filter((id) => id !== repoId),
      })),
    repos: (workspaceId) => {
      if (workspaceId === undefined) return fromStore(deps.repos.list(), "workspace.repo_not_found");
      const workspace = loadWorkspace(deps, workspaceId);
      return workspace.ok ? workspaceRepos(deps, workspace.value) : workspace;
    },
    repo: (id) => fromStore(deps.repos.get(id), "workspace.repo_not_found"),
    sync: (workspaceId) => syncWorkspace(deps, workspaceId),
    ensureCloned: (repoId) => ensureCloned(deps, repoId),
  };
}

function update(deps: WorkspaceServiceDeps, id: string, changes: WorkspaceChanges): WorkspaceResult<Workspace> {
  const workspace = loadWorkspace(deps, id);
  if (!workspace.ok) return workspace;
  let settingsOverrides = workspace.value.settingsOverrides;
  if (changes.settingsOverrides !== undefined) {
    const validated = validateLayer(`workspace:${id}`, changes.settingsOverrides);
    if (!validated.ok) return err(workspaceError("workspace.invalid", validated.error.message));
    settingsOverrides = validated.value;
  }
  const name = validName(changes.name ?? workspace.value.name);
  if (!name.ok) return name;
  return saveWorkspace(deps, { ...workspace.value, name: name.value, settingsOverrides });
}

function remove(deps: WorkspaceServiceDeps, id: string): WorkspaceResult<void> {
  const workspace = loadWorkspace(deps, id);
  if (!workspace.ok) return workspace;
  const deleted = deps.workspaces.delete(id);
  if (!deleted.ok && deleted.error.code === "store.conflict") {
    return err(workspaceError("workspace.in_use", `workspace ${id} still has sessions`));
  }
  const removed = fromStore(deleted, "workspace.not_found");
  return removed.ok ? forgetUnused(deps, memberRepoIds(workspace.value)) : removed;
}

function addSource(deps: WorkspaceServiceDeps, workspaceId: string, input: NewRepoSource): WorkspaceResult<RepoSource> {
  const org = input.org?.trim() ?? null;
  const source: RepoSource = {
    id: deps.newId(),
    kind: input.kind,
    org: org === "" ? null : org,
    selector: input.selector.trim(),
    lastSyncAt: null,
    snapshot: null,
    repoIds: [],
  };
  if (source.kind !== "manual") {
    const selector = selectorForSource(source);
    if (!selector.ok) return err(workspaceError("workspace.invalid", selector.error.message));
  }
  const workspace = loadWorkspace(deps, workspaceId);
  if (!workspace.ok) return workspace;
  if (workspace.value.sources.some((existing) => sameSource(existing, source))) {
    return err(workspaceError("workspace.source_exists", `workspace ${workspaceId} already has this ${source.kind} source`));
  }
  const saved = saveWorkspace(deps, { ...workspace.value, sources: [...workspace.value.sources, source] });
  return saved.ok ? ok(source) : saved;
}

// Pinned repos stay in the workspace when the source that found them goes.
function removeSource(deps: WorkspaceServiceDeps, workspaceId: string, sourceId: string): WorkspaceResult<void> {
  const workspace = loadWorkspace(deps, workspaceId);
  if (!workspace.ok) return workspace;
  if (!workspace.value.sources.some((source) => source.id === sourceId)) {
    return err(workspaceError("workspace.source_not_found", `workspace ${workspaceId} has no source ${sourceId}`));
  }
  return replace(deps, workspaceId, (current) => ({
    ...current,
    sources: current.sources.filter((source) => source.id !== sourceId),
  }));
}

function pinRepo(deps: WorkspaceServiceDeps, workspaceId: string, repoId: string): WorkspaceResult<void> {
  const repo = fromStore(deps.repos.get(repoId), "workspace.repo_not_found");
  if (!repo.ok) return repo;
  return replace(deps, workspaceId, (workspace) =>
    workspace.pinnedRepoIds.includes(repoId)
      ? workspace
      : { ...workspace, pinnedRepoIds: [...workspace.pinnedRepoIds, repoId] },
  );
}

// Saves `change(workspace)` and forgets the never-cloned repos that left it.
function replace(
  deps: WorkspaceServiceDeps,
  workspaceId: string,
  change: (workspace: Workspace) => Workspace,
): WorkspaceResult<void> {
  const workspace = loadWorkspace(deps, workspaceId);
  if (!workspace.ok) return workspace;
  const saved = saveWorkspace(deps, change(workspace.value));
  if (!saved.ok) return saved;
  return forgetUnused(deps, departed(memberRepoIds(workspace.value), saved.value));
}

function sameSource(a: RepoSource, b: RepoSource): boolean {
  return a.kind === b.kind && (a.org ?? "").toLowerCase() === (b.org ?? "").toLowerCase() && a.selector === b.selector;
}

function validName(name: string): WorkspaceResult<string> {
  const trimmed = name.trim();
  return trimmed.length > 0 ? ok(trimmed) : err(workspaceError("workspace.invalid", "a workspace needs a name"));
}
