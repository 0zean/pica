import type { McpServerDef } from "@pica/protocol";
import type { ConfigError } from "../config/errors.ts";
import { attachMcpServers } from "../mcp-attach/attach.ts";
import { estimateMcpPlanTokens } from "../mcp-attach/token-estimate.ts";
import type { McpAttachment, McpAttachmentPlan, McpToolCatalog } from "../mcp-attach/types.ts";
import type { ManagedMcpAllowlist } from "../policy/index.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { isLiveSessionState } from "../sessions/transitions.ts";
import { checkedMcpServerEntry } from "./entry.ts";
import { mcpManageError } from "./errors.ts";
import type { McpManageError } from "./errors.ts";
import type {
  McpAttachmentRecord,
  McpAttachmentState,
  McpAttachmentStore,
  McpDefinitions,
  McpServerFileTarget,
  McpServerFiles,
  McpSessionAccess,
} from "./ports.ts";

export type McpAttachTarget =
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "workspace"; readonly workspaceId: string };

export interface McpAttachRequest {
  readonly serverId: string;
  readonly target: McpAttachTarget;
  readonly agent: string | null;
  readonly acknowledgeCacheReset: boolean;
}

export interface McpAttachmentsView {
  readonly attachments: readonly McpAttachmentRecord[];
  // Null while a server's tool list is unknown.
  readonly toolDefinitionTokens: number | null;
}

export interface McpManagerDeps {
  readonly files: McpServerFiles;
  readonly definitions: McpDefinitions;
  readonly attachments: McpAttachmentStore;
  readonly sessions: McpSessionAccess;
  // Tool lists from M-06's health checks.
  readonly catalog: () => McpToolCatalog;
  readonly agents: () => readonly string[];
  readonly managedAllowlist?: () => ManagedMcpAllowlist | undefined;
  // Called after a server is added, changed or removed, so health checks follow the files.
  readonly onServersChanged?: () => void;
}

export interface McpManager {
  list(workspaceId?: string): Result<readonly McpServerDef[], McpManageError>;
  add(server: McpServerDef, workspaceId?: string): Result<McpServerDef, McpManageError>;
  update(server: McpServerDef, workspaceId?: string): Result<McpServerDef, McpManageError>;
  // Also detaches the server everywhere it was attached.
  remove(serverId: string, workspaceId?: string): Result<undefined, McpManageError>;
  attachments(target: McpAttachTarget): Result<McpAttachmentsView, McpManageError>;
  attach(request: McpAttachRequest): Promise<Result<{ readonly toolDefinitionTokens: number | null }, McpManageError>>;
  detach(request: McpAttachRequest): Promise<Result<undefined, McpManageError>>;
  // A new session starts with its workspace's servers.
  seedSession(sessionId: string, workspaceId: string): Result<undefined, McpManageError>;
  // What the session's runtime should start with. Attachments to servers or agents that no longer
  // exist are left out rather than failing the session.
  sessionPlan(sessionId: string, workspaceId: string): Result<McpAttachmentPlan, McpManageError>;
}

export function createMcpManager(deps: McpManagerDeps): McpManager {
  function definitions(workspaceId?: string): Result<readonly McpServerDef[], McpManageError> {
    const loaded = deps.definitions(workspaceId);
    return loaded.ok ? loaded : err(configFailure(loaded.error));
  }

  function fileTarget(server: Pick<McpServerDef, "scope">, workspaceId: string | undefined): Result<McpServerFileTarget, McpManageError> {
    if (server.scope === "global") {
      return ok({ scope: "global" });
    }
    if (server.scope === "workspace" && workspaceId !== undefined) {
      return ok({ scope: "workspace", workspaceId });
    }
    const message =
      server.scope === "workspace"
        ? "a workspace-scope server needs workspaceId"
        : "repo-scope servers live in the repo's .pica/mcp.jsonc and are edited there";
    return err(mcpManageError("mcp_manage.invalid", message, { scope: server.scope }));
  }

  function save(server: McpServerDef, workspaceId: string | undefined, exists: boolean): Result<McpServerDef, McpManageError> {
    const target = fileTarget(server, workspaceId);
    if (!target.ok) {
      return target;
    }
    const path = deps.files.path(target.value);
    if (!path.ok) {
      return err(configFailure(path.error));
    }
    const ids = deps.files.ids(target.value);
    if (!ids.ok) {
      return err(configFailure(ids.error));
    }
    const present = ids.value.includes(server.id);
    if (present !== exists) {
      return exists
        ? err(mcpManageError("mcp_manage.not_found", `no MCP server ${server.id} in ${path.value}`, { serverId: server.id }))
        : err(mcpManageError("mcp_manage.already_exists", `an MCP server ${server.id} is already in ${path.value}`, { serverId: server.id }));
    }
    const checked = checkedMcpServerEntry(server, path.value);
    if (!checked.ok) {
      return err(configFailure(checked.error));
    }
    const written = deps.files.write(target.value, server.id, checked.value.entry);
    if (!written.ok) {
      return err(configFailure(written.error));
    }
    deps.onServersChanged?.();
    return ok(checked.value.definition);
  }

  function remove(serverId: string, workspaceId?: string): Result<undefined, McpManageError> {
    const target: McpServerFileTarget = workspaceId === undefined ? { scope: "global" } : { scope: "workspace", workspaceId };
    const ids = deps.files.ids(target);
    if (!ids.ok) {
      return err(configFailure(ids.error));
    }
    if (!ids.value.includes(serverId)) {
      return err(mcpManageError("mcp_manage.not_found", `no MCP server ${serverId} at ${target.scope} scope`, { serverId }));
    }
    const written = deps.files.write(target, serverId, undefined);
    if (!written.ok) {
      return err(configFailure(written.error));
    }
    const detached = updateState((state) => withoutUnresolved(state, serverId));
    deps.onServersChanged?.();
    return detached;
  }

  function readState(): Result<McpAttachmentState, McpManageError> {
    const state = deps.attachments.read();
    return state.ok ? state : err(mcpManageError("mcp_manage.write_failed", `attachments: ${state.error.message}`));
  }

  function updateState(change: (state: McpAttachmentState) => McpAttachmentState): Result<undefined, McpManageError> {
    const state = readState();
    if (!state.ok) {
      return state;
    }
    const written = deps.attachments.write(change(state.value));
    return written.ok ? ok(undefined) : err(mcpManageError("mcp_manage.write_failed", `attachments: ${written.error.message}`));
  }

  function workspaceOf(target: McpAttachTarget): Result<string, McpManageError> {
    if (target.kind === "workspace") {
      return ok(target.workspaceId);
    }
    const session = deps.sessions.get(target.sessionId);
    return session.ok
      ? ok(session.value.workspaceId)
      : err(mcpManageError("mcp_manage.not_found", session.error.message, { sessionId: target.sessionId }));
  }

  function recordsOf(state: McpAttachmentState, target: McpAttachTarget): readonly McpAttachmentRecord[] {
    return (target.kind === "session" ? state.sessions[target.sessionId] : state.workspaces[target.workspaceId]) ?? [];
  }

  function plan(
    servers: readonly McpServerDef[],
    records: readonly McpAttachmentRecord[],
  ): Result<McpAttachmentPlan, McpManageError> {
    const planned = attachMcpServers(servers, deps.agents(), records.map(toAttachment), deps.managedAllowlist?.());
    if (planned.ok) {
      return planned;
    }
    const policy = planned.error.issues.find((issue) => issue.policy !== undefined)?.policy;
    return err(
      policy === undefined
        ? mcpManageError("mcp_manage.not_attachable", planned.error.message, { issues: planned.error.issues })
        : mcpManageError("mcp_manage.policy_denied", planned.error.message, { policy, issues: planned.error.issues }),
    );
  }

  function tokens(planned: McpAttachmentPlan): number | null {
    const estimate = estimateMcpPlanTokens(planned, deps.catalog());
    const parts = [estimate.session, ...estimate.agents.map((agent) => agent.estimate)];
    return parts.every((part) => part.complete) ? parts.reduce((sum, part) => sum + part.tokens, 0) : null;
  }

  function attachments(target: McpAttachTarget): Result<McpAttachmentsView, McpManageError> {
    const workspaceId = workspaceOf(target);
    if (!workspaceId.ok) {
      return workspaceId;
    }
    const state = readState();
    if (!state.ok) {
      return state;
    }
    const servers = definitions(workspaceId.value);
    if (!servers.ok) {
      return servers;
    }
    const records = usable(recordsOf(state.value, target), servers.value, deps.agents());
    const planned = plan(servers.value, records);
    return ok({ attachments: records, toolDefinitionTokens: planned.ok ? tokens(planned.value) : null });
  }

  // A live session's tool set is fixed at start (PLAN.md §5.5): changing it reopens the runtime,
  // which the user confirms first because the cached prompt prefix is lost.
  async function change(request: McpAttachRequest, attaching: boolean): Promise<Result<McpAttachmentPlan, McpManageError>> {
    const workspaceId = workspaceOf(request.target);
    if (!workspaceId.ok) {
      return workspaceId;
    }
    const servers = definitions(workspaceId.value);
    if (!servers.ok) {
      return servers;
    }
    const state = readState();
    if (!state.ok) {
      return state;
    }
    const record: McpAttachmentRecord = { serverId: request.serverId, agent: request.agent };
    const before = recordsOf(state.value, request.target);
    const after = attaching ? [...before.filter((r) => !sameRecord(r, record)), record] : before.filter((r) => !sameRecord(r, record));
    if (attaching && !servers.value.some((server) => server.id === request.serverId)) {
      return err(mcpManageError("mcp_manage.not_found", `no MCP server ${request.serverId} is defined for this workspace`, { serverId: request.serverId }));
    }
    if (attaching && request.agent !== null && !deps.agents().includes(request.agent)) {
      return err(mcpManageError("mcp_manage.not_attachable", `no agent named "${request.agent}"`, { agent: request.agent }));
    }
    if (!attaching && after.length === before.length) {
      return err(mcpManageError("mcp_manage.not_found", `${request.serverId} is not attached here`, { serverId: request.serverId }));
    }
    const planned = plan(servers.value, attaching ? usable(after, servers.value, deps.agents()) : after);
    if (!planned.ok) {
      return planned;
    }
    const live = request.target.kind === "session" ? liveState(request.target.sessionId) : ok(undefined);
    if (!live.ok) {
      return live;
    }
    if (live.value !== undefined) {
      const guarded = guardLiveChange(live.value, request, tokens(planned.value));
      if (!guarded.ok) {
        return guarded;
      }
    }
    const written = deps.attachments.write(withRecords(state.value, request.target, after));
    if (!written.ok) {
      return err(mcpManageError("mcp_manage.write_failed", `attachments: ${written.error.message}`));
    }
    if (live.value !== undefined && request.target.kind === "session") {
      const reopened = await deps.sessions.reconfigure(request.target.sessionId);
      if (!reopened.ok) {
        restore(request.target, before);
        return err(mcpManageError("mcp_manage.session_busy", reopened.error.message, { sessionId: request.target.sessionId }));
      }
    }
    return planned;
  }

  // Puts back only the target's records, keeping any other change made while the session reopened.
  function restore(target: McpAttachTarget, records: readonly McpAttachmentRecord[]): void {
    updateState((state) => withRecords(state, target, records));
  }

  // After a server is removed from one file, it is detached wherever it no longer resolves: a
  // workspace's own copy going leaves the global one, and other workspaces' copies, attached.
  function withoutUnresolved(state: McpAttachmentState, serverId: string): McpAttachmentState {
    const resolves = (workspaceId: string | undefined): boolean => {
      const servers = deps.definitions(workspaceId);
      return servers.ok && servers.value.some((server) => server.id === serverId);
    };
    const strip = (records: readonly McpAttachmentRecord[], workspaceId: string | undefined): readonly McpAttachmentRecord[] =>
      resolves(workspaceId) ? records : records.filter((record) => record.serverId !== serverId);
    const sessionWorkspace = (sessionId: string): string | undefined => {
      const session = deps.sessions.get(sessionId);
      return session.ok ? session.value.workspaceId : undefined;
    };
    return {
      workspaces: Object.fromEntries(Object.entries(state.workspaces).map(([id, records]) => [id, strip(records, id)])),
      sessions: Object.fromEntries(Object.entries(state.sessions).map(([id, records]) => [id, strip(records, sessionWorkspace(id))])),
    };
  }

  // The session's state when it is live, else undefined.
  function liveState(sessionId: string): Result<string | undefined, McpManageError> {
    const session = deps.sessions.get(sessionId);
    if (!session.ok) {
      return err(mcpManageError("mcp_manage.not_found", session.error.message, { sessionId }));
    }
    return ok(isLiveSessionState(session.value.state) ? session.value.state : undefined);
  }

  return {
    list: definitions,
    add: (server, workspaceId) => save(server, workspaceId, false),
    update: (server, workspaceId) => save(server, workspaceId, true),
    remove,
    attachments,
    async attach(request) {
      const changed = await change(request, true);
      if (!changed.ok) {
        return changed;
      }
      const single = singleServerPlan(changed.value, request.serverId);
      return ok({ toolDefinitionTokens: tokens(single) });
    },
    async detach(request) {
      const changed = await change(request, false);
      return changed.ok ? ok(undefined) : changed;
    },
    seedSession(sessionId, workspaceId) {
      return updateState((state) =>
        state.sessions[sessionId] === undefined
          ? { ...state, sessions: { ...state.sessions, [sessionId]: state.workspaces[workspaceId] ?? [] } }
          : state,
      );
    },
    sessionPlan(sessionId, workspaceId) {
      const servers = definitions(workspaceId);
      if (!servers.ok) {
        return servers;
      }
      const state = readState();
      if (!state.ok) {
        return state;
      }
      return plan(servers.value, usable(state.value.sessions[sessionId] ?? [], servers.value, deps.agents()));
    },
  };
}

function guardLiveChange(state: string, request: McpAttachRequest, toolDefinitionTokens: number | null): Result<undefined, McpManageError> {
  const sessionId = request.target.kind === "session" ? request.target.sessionId : "";
  if (state !== "idle") {
    return err(mcpManageError("mcp_manage.session_busy", `session ${sessionId} is ${state}; change its MCP servers when it is idle`, { sessionId, state }));
  }
  if (!request.acknowledgeCacheReset) {
    return err(
      mcpManageError(
        "mcp_manage.cache_reset_unconfirmed",
        "Changing a running session's MCP servers restarts its runtime and its prompt cache; the next turn pays full price for the whole context.",
        { sessionId, toolDefinitionTokens },
      ),
    );
  }
  return ok(undefined);
}

function toAttachment(record: McpAttachmentRecord): McpAttachment {
  return {
    serverId: record.serverId,
    target: record.agent === null ? { kind: "session" } : { kind: "agent", agent: record.agent },
    tools: null,
  };
}

function usable(
  records: readonly McpAttachmentRecord[],
  servers: readonly McpServerDef[],
  agents: readonly string[],
): readonly McpAttachmentRecord[] {
  const ids = new Set(servers.map((server) => server.id));
  return records.filter((record) => ids.has(record.serverId) && (record.agent === null || agents.includes(record.agent)));
}

function sameRecord(a: McpAttachmentRecord, b: McpAttachmentRecord): boolean {
  return a.serverId === b.serverId && a.agent === b.agent;
}

function withRecords(state: McpAttachmentState, target: McpAttachTarget, records: readonly McpAttachmentRecord[]): McpAttachmentState {
  return target.kind === "session"
    ? { ...state, sessions: { ...state.sessions, [target.sessionId]: records } }
    : { ...state, workspaces: { ...state.workspaces, [target.workspaceId]: records } };
}

function singleServerPlan(planned: McpAttachmentPlan, serverId: string): McpAttachmentPlan {
  return {
    session: planned.session.filter((server) => server.definition.id === serverId),
    agents: planned.agents.map((agent) => ({ agent: agent.agent, servers: agent.servers.filter((server) => server.definition.id === serverId) })),
  };
}

function configFailure(error: ConfigError): McpManageError {
  const code = error.code === "config.inline_secret" ? "mcp_manage.inline_secret" : error.code === "config.invalid" ? "mcp_manage.invalid" : "mcp_manage.write_failed";
  return mcpManageError(code, error.message, { file: error.file, issues: error.issues });
}
