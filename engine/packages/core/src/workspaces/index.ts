export { resolveWorkspaceConfig, workspaceConfigLayer } from "./config.ts";
export type { WorkspaceDiscovery, WorkspaceResult, WorkspaceServiceDeps } from "./deps.ts";
export { workspaceError, type WorkspaceError, type WorkspaceErrorCode } from "./errors.ts";
export { memberRepoIds } from "./membership.ts";
export {
  createWorkspaceService,
  type NewRepoSource,
  type WorkspaceChanges,
  type WorkspaceService,
} from "./service.ts";
export type { WorkspaceSync } from "./sync.ts";
