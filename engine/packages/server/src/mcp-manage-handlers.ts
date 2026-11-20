import { mcpManageProtocolCode } from "@pica/core";
import type { McpAttachTarget, McpManageError, Result } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { MethodRouter } from "./router.ts";
import type { ComposedMcp } from "./mcp-composition.ts";

// A-13: managing servers and what they are attached to (docs/mcp.md).
export function registerMcpManageHandlers(router: MethodRouter, mcp: ComposedMcp): void {
  const { manager } = mcp;
  router.register("mcp.list", (params) => ({ servers: [...unwrap(manager.list(params.workspaceId))] }));
  router.register("mcp.add", (params) => ({ server: unwrap(manager.add(params.server, params.workspaceId)) }));
  router.register("mcp.update", (params) => ({ server: unwrap(manager.update(params.server, params.workspaceId)) }));
  router.register("mcp.remove", (params) => {
    unwrap(manager.remove(params.id, params.workspaceId));
    return { ok: true };
  });
  router.register("mcp.attachments", (params) => {
    const view = unwrap(manager.attachments(attachTarget(params)));
    return { attachments: [...view.attachments], toolDefinitionTokens: view.toolDefinitionTokens };
  });
  router.register("mcp.attach", async (params) => {
    const attached = unwrap(
      await manager.attach({
        serverId: params.serverId,
        target: attachTarget(params),
        agent: params.agent ?? null,
        acknowledgeCacheReset: params.acknowledgeCacheReset === true,
      }),
    );
    return { toolDefinitionTokens: attached.toolDefinitionTokens };
  });
  router.register("mcp.detach", async (params) => {
    unwrap(
      await manager.detach({
        serverId: params.serverId,
        target: attachTarget(params),
        agent: params.agent ?? null,
        acknowledgeCacheReset: params.acknowledgeCacheReset === true,
      }),
    );
    return { ok: true };
  });
  router.register("mcp.login", async (params) => {
    const signedIn = await mcp.login(params.id);
    if (!signedIn.ok) {
      throw new RpcFailure(signedIn.error.code, signedIn.error.message, { serverId: params.id });
    }
    return { ok: true };
  });
}

function attachTarget(params: { readonly sessionId?: string | undefined; readonly workspaceId?: string | undefined }): McpAttachTarget {
  if (params.sessionId !== undefined && params.workspaceId === undefined) {
    return { kind: "session", sessionId: params.sessionId };
  }
  if (params.workspaceId !== undefined && params.sessionId === undefined) {
    return { kind: "workspace", workspaceId: params.workspaceId };
  }
  throw new RpcFailure("invalid_params", "Give exactly one of sessionId and workspaceId.");
}

function unwrap<T>(result: Result<T, McpManageError>): T {
  if (result.ok) {
    return result.value;
  }
  const { code, message, details } = result.error;
  throw new RpcFailure(mcpManageProtocolCode(code), message, { reason: code, ...details });
}
