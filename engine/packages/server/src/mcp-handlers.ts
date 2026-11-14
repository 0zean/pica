import type { McpHealthMonitor } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { MethodRouter } from "./router.ts";

export function registerMcpHealthHandlers(router: MethodRouter, monitor: McpHealthMonitor): void {
  router.register("mcp.status", (params) => {
    const status = monitor.status(params.id);
    if (status === undefined) {
      throw new RpcFailure("not_found", `No MCP server ${params.id} is configured.`, { serverId: params.id });
    }
    return { status };
  });
  router.register("mcp.statusList", () => ({ statuses: monitor.statuses() }));
  router.register("mcp.restart", (params) => {
    if (!monitor.restart(params.id)) {
      throw new RpcFailure("not_found", `No MCP server ${params.id} is configured.`, { serverId: params.id });
    }
    return { ok: true };
  });
}
