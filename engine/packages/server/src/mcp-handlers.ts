import { listMcpPresets, renderMcpPreset } from "@pica/core";
import type { McpHealthMonitor, McpPresetContext } from "@pica/core";
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

// M-02: listing and rendering presets reads no file and changes nothing; adding the rendered
// server is `mcp.add`. Presets follow the configured GitHub host (D-20).
export function registerMcpPresetHandlers(router: MethodRouter, context: McpPresetContext = {}): void {
  router.register("mcp.presets", () => ({ presets: listMcpPresets(context) }));
  router.register("mcp.renderPreset", (params) => {
    const options = {
      ...(params.serverId === undefined ? {} : { serverId: params.serverId }),
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    };
    const rendered = renderMcpPreset(params.presetId, params.parameters, options, context);
    if (!rendered.ok) {
      const code = rendered.error.code === "mcp_preset.unknown" ? "not_found" : "invalid_params";
      throw new RpcFailure(code, rendered.error.message, { presetId: params.presetId, issues: rendered.error.issues });
    }
    return { server: rendered.value };
  });
}
