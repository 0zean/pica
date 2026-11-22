import type { JsonObject, JsonValue, Repo, RepoSource, Workspace, WorkspaceError, WorkspaceResult, WorkspaceService } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { ErrorCodeName } from "./errors.ts";
import type { MethodParams, MethodResult, MethodRouter } from "./router.ts";

type WorkspaceDto = MethodResult<"workspace.get">["workspace"];
type OverridesDto = WorkspaceDto["overrides"];
type RepoDto = MethodResult<"repo.get">["repo"];

export interface WorkspaceHandlerDeps {
  readonly workspaces: WorkspaceService;
  readonly onChanged: (workspace: WorkspaceDto) => void;
  readonly onDeleted?: (workspaceId: string) => void;
}

const errorCodes: Readonly<Record<WorkspaceError["code"], ErrorCodeName>> = {
  "workspace.not_found": "not_found",
  "workspace.source_not_found": "not_found",
  "workspace.repo_not_found": "not_found",
  "workspace.source_exists": "already_exists",
  "workspace.invalid": "invalid_params",
  "workspace.in_use": "invalid_state",
  "workspace.discovery_failed": "github_request_failed",
  "workspace.clone_failed": "git_failed",
  "workspace.store_failed": "internal_error",
};

function unwrap<T>(result: WorkspaceResult<T>): T {
  if (result.ok) return result.value;
  const { discovery } = result.error;
  if (discovery !== undefined) {
    const fix = "fix" in discovery ? discovery.fix : undefined;
    throw new RpcFailure(discovery.code, discovery.message, { reason: result.error.code, ...discovery.details }, fix);
  }
  throw new RpcFailure(errorCodes[result.error.code], result.error.message, { reason: result.error.code });
}

const done = { ok: true } as const;

export function registerWorkspaceHandlers(router: MethodRouter, deps: WorkspaceHandlerDeps): void {
  const { workspaces } = deps;
  const changed = (workspaceId: string): void => {
    deps.onChanged(toWorkspaceDto(unwrap(workspaces.get(workspaceId))));
  };
  router.register("workspace.list", () => ({ workspaces: unwrap(workspaces.list()).map(toWorkspaceDto) }));
  router.register("workspace.get", ({ id }) => ({ workspace: toWorkspaceDto(unwrap(workspaces.get(id))) }));
  router.register("workspace.create", ({ name }) => {
    const workspace = toWorkspaceDto(unwrap(workspaces.create(name)));
    deps.onChanged(workspace);
    return { workspace };
  });
  router.register("workspace.update", (params) => {
    const workspace = toWorkspaceDto(unwrap(workspaces.update(params.id, changesFor(workspaces, params))));
    deps.onChanged(workspace);
    return { workspace };
  });
  router.register("workspace.delete", ({ id }) => {
    unwrap(workspaces.delete(id));
    deps.onDeleted?.(id);
    return done;
  });
  router.register("workspace.addSource", ({ workspaceId, kind, org, selector }) => {
    const source = unwrap(workspaces.addSource(workspaceId, { kind, org: org ?? null, selector: selector ?? "" }));
    changed(workspaceId);
    return { source: toSourceDto(source) };
  });
  router.register("workspace.removeSource", ({ workspaceId, sourceId }) => {
    unwrap(workspaces.removeSource(workspaceId, sourceId));
    changed(workspaceId);
    return done;
  });
  router.register("workspace.pinRepo", ({ workspaceId, repoId }) => {
    unwrap(workspaces.pinRepo(workspaceId, repoId));
    changed(workspaceId);
    return done;
  });
  router.register("workspace.unpinRepo", ({ workspaceId, repoId }) => {
    unwrap(workspaces.unpinRepo(workspaceId, repoId));
    changed(workspaceId);
    return done;
  });
  router.register("workspace.removeRepo", ({ workspaceId, repoId }) => {
    unwrap(workspaces.removeRepo(workspaceId, repoId));
    changed(workspaceId);
    return done;
  });
  router.register("workspace.sync", async ({ workspaceId }) => {
    const synced = unwrap(await workspaces.sync(workspaceId));
    changed(workspaceId);
    return { added: [...synced.added], removed: [...synced.removed] };
  });
  router.register("repo.list", ({ workspaceId }) => ({ repos: unwrap(workspaces.repos(workspaceId)).map(toRepoDto) }));
  router.register("repo.get", ({ id }) => ({ repo: toRepoDto(unwrap(workspaces.repo(id))) }));
}

// The protocol's overrides are a view of two keys of the workspace config layer; other keys are kept.
function changesFor(workspaces: WorkspaceService, params: MethodParams<"workspace.update">): { name?: string; settingsOverrides?: JsonObject } {
  const name = params.name === undefined ? {} : { name: params.name };
  const { overrides } = params;
  if (overrides === undefined) return name;
  if ((overrides.mcpServerIds ?? []).length > 0) {
    throw new RpcFailure("invalid_params", "Per-workspace MCP servers are not stored yet; attach servers to sessions instead.", {
      reason: "workspace.mcp_overrides_unsupported",
    });
  }
  const current = unwrap(workspaces.get(params.id)).settingsOverrides;
  const routing = withKey(objectAt(current, "routing"), "profile", overrides.routingProfile);
  const budget = withKey(objectAt(current, "budget"), "workspaceDailyCredits", overrides.dailyCredits);
  return { ...name, settingsOverrides: withKey(withKey(current, "routing", nonEmpty(routing)), "budget", nonEmpty(budget)) };
}

export function toWorkspaceDto(workspace: Workspace): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    sources: workspace.sources.map(toSourceDto),
    pinnedRepoIds: [...workspace.pinnedRepoIds],
    overrides: toOverridesDto(workspace.settingsOverrides),
  };
}

function toOverridesDto(settings: JsonObject): OverridesDto {
  const profile = objectAt(settings, "routing")["profile"];
  const dailyCredits = objectAt(settings, "budget")["workspaceDailyCredits"];
  return {
    ...(profile === "off" || profile === "balanced" || profile === "strict" ? { routingProfile: profile } : {}),
    ...(typeof dailyCredits === "number" ? { dailyCredits } : {}),
  };
}

function toSourceDto(source: RepoSource): WorkspaceDto["sources"][number] {
  return {
    id: source.id,
    kind: source.kind,
    org: source.org,
    selector: source.selector === "" ? null : source.selector,
    lastSyncedAt: source.lastSyncAt,
  };
}

const cloneStates = { absent: "available", cloning: "cloning", ready: "cloned", failed: "failed" } as const;

export function toRepoDto(repo: Repo): RepoDto {
  return { ...repo, cloneState: cloneStates[repo.cloneState] };
}

function objectAt(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  return isJsonObject(value) ? value : {};
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withKey(object: JsonObject, key: string, value: JsonValue | undefined): JsonObject {
  const rest = Object.fromEntries(Object.entries(object).filter(([existing]) => existing !== key));
  return value === undefined ? rest : { ...rest, [key]: value };
}

function nonEmpty(object: JsonObject): JsonObject | undefined {
  return Object.keys(object).length === 0 ? undefined : object;
}
