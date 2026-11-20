import type { McpServerDef, PicaMcpServerEntry } from "@pica/protocol";
import type { ConfigError } from "../config/errors.ts";
import type { Result } from "../result.ts";
import type { SessionState } from "../store/index.ts";

// The `mcp.jsonc` files `mcp.add`, `mcp.update` and `mcp.remove` write. Repo-scope files belong to
// the repo and are edited there.
export type McpServerFileTarget = { readonly scope: "global" } | { readonly scope: "workspace"; readonly workspaceId: string };

export interface McpServerFiles {
  path(target: McpServerFileTarget): Result<string, ConfigError>;
  // The ids under `servers` in the target file; empty when the file does not exist.
  ids(target: McpServerFileTarget): Result<readonly string[], ConfigError>;
  // Sets or, with `undefined`, removes one entry, keeping the rest of the file and its comments.
  write(target: McpServerFileTarget, id: string, entry: PicaMcpServerEntry | undefined): Result<undefined, ConfigError>;
}

// One server attached to a workspace or a session. `agent` null means the whole session.
export interface McpAttachmentRecord {
  readonly serverId: string;
  readonly agent: string | null;
}

export interface McpAttachmentState {
  readonly workspaces: Readonly<Record<string, readonly McpAttachmentRecord[]>>;
  readonly sessions: Readonly<Record<string, readonly McpAttachmentRecord[]>>;
}

export interface McpAttachmentStoreError {
  readonly message: string;
}

export interface McpAttachmentStore {
  read(): Result<McpAttachmentState, McpAttachmentStoreError>;
  write(state: McpAttachmentState): Result<undefined, McpAttachmentStoreError>;
}

export interface McpSessionSnapshot {
  readonly workspaceId: string;
  readonly state: SessionState;
}

export interface McpSessionAccess {
  get(sessionId: string): Result<McpSessionSnapshot, { readonly message: string }>;
  // Reopens a live, idle session's runtime so it starts with the servers attached now.
  reconfigure(sessionId: string): Promise<Result<undefined, { readonly code: string; readonly message: string }>>;
}

// Resolved servers: global ones, with a workspace's own over them when an id is given.
export type McpDefinitions = (workspaceId?: string) => Result<readonly McpServerDef[], ConfigError>;
