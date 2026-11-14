import type { DiscoveryError } from "../discovery/errors.ts";

export type WorkspaceErrorCode =
  | "workspace.not_found"
  | "workspace.source_not_found"
  | "workspace.repo_not_found"
  | "workspace.source_exists"
  | "workspace.invalid"
  | "workspace.in_use"
  | "workspace.discovery_failed"
  | "workspace.clone_failed"
  | "workspace.store_failed";

export interface WorkspaceError {
  readonly code: WorkspaceErrorCode;
  readonly message: string;
  // Set for `workspace.discovery_failed`: the GitHub error, whose code and `fix` reach the client.
  readonly discovery?: DiscoveryError;
}

export function workspaceError(code: WorkspaceErrorCode, message: string): WorkspaceError {
  return { code, message };
}
