import type { DiscoveryFilter, DiscoveryResult } from "../discovery/discovery.ts";
import type { GitHubRestClient } from "../discovery/ports.ts";
import type { RepoRegistryError } from "../repos/errors.ts";
import { err, ok, type Result } from "../result.ts";
import type { Repo, Workspace } from "../store/entities.ts";
import type { RepoRepository, StoreError, WorkspaceRepository } from "../store/ports.ts";
import { workspaceError, type WorkspaceError, type WorkspaceErrorCode } from "./errors.ts";

export interface WorkspaceDiscovery {
  // An authenticated client for the host that serves `org`.
  client(org: string): DiscoveryResult<GitHubRestClient>;
  readonly filter: DiscoveryFilter;
}

export interface WorkspaceServiceDeps {
  readonly workspaces: WorkspaceRepository;
  readonly repos: RepoRepository;
  readonly discovery: WorkspaceDiscovery;
  // Clones a registered repo into the managed root (R-03 `RepoRegistry.addByUrl`).
  readonly clone: (remoteUrl: string) => Promise<Result<Repo, RepoRegistryError>>;
  readonly newId: () => string;
  readonly clock: () => string;
}

export type WorkspaceResult<T> = Result<T, WorkspaceError>;

export function fromStore<T>(result: Result<T, StoreError>, notFound: WorkspaceErrorCode): WorkspaceResult<T> {
  if (result.ok) return result;
  const code = result.error.code === "store.not_found" ? notFound : "workspace.store_failed";
  return err(workspaceError(code, result.error.message));
}

export function loadWorkspace(deps: WorkspaceServiceDeps, id: string): WorkspaceResult<Workspace> {
  return fromStore(deps.workspaces.get(id), "workspace.not_found");
}

export function saveWorkspace(deps: WorkspaceServiceDeps, workspace: Workspace): WorkspaceResult<Workspace> {
  const saved = fromStore(deps.workspaces.save(workspace), "workspace.not_found");
  return saved.ok ? ok(workspace) : saved;
}
