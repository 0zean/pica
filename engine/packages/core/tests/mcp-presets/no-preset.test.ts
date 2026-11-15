import { describe, expect, it } from "vitest";
import type { McpServerDef } from "@pica/protocol";
import { attachMcpServers, listMcpPresets, mcpSessionConfig, renderEnabledMcpPresets } from "../../src/index.ts";
import type { McpAttachment, McpPresetSelection, McpSessionConfig } from "../../src/index.ts";

const agents = ["bulk-reader", "repo-scout"];

function sessionConfig(servers: readonly McpServerDef[], attachments: readonly McpAttachment[]): McpSessionConfig {
  const plan = attachMcpServers(servers, agents, attachments);
  if (!plan.ok) {
    throw new Error(plan.error.message);
  }
  return mcpSessionConfig(plan.value);
}

function enabledServers(selections: readonly McpPresetSelection[]): McpServerDef[] {
  const result = renderEnabledMcpPresets(selections);
  if (!result.ok) {
    throw new Error(result.error.map((error) => error.message).join("\n"));
  }
  return result.value;
}

const noMcp: McpSessionConfig = { customAgents: [{ name: "bulk-reader" }, { name: "repo-scout" }] };

describe("no preset enabled", () => {
  it("contributes no server, so the session config carries no MCP servers", () => {
    expect(listMcpPresets()).toHaveLength(4);
    expect(enabledServers([])).toEqual([]);
    expect(sessionConfig(enabledServers([]), [])).toEqual(noMcp);
  });

  it("ignores disabled presets, even with parameters that would not validate", () => {
    const disabled: McpPresetSelection[] = [
      { presetId: "github", enabled: false, parameters: {} },
      { presetId: "snowflake", enabled: false, parameters: {} },
      { presetId: "datadog", enabled: false, parameters: { site: "not a site" } },
    ];
    expect(enabledServers(disabled)).toEqual([]);
    expect(sessionConfig(enabledServers(disabled), [])).toEqual(noMcp);
  });

  it("an enabled preset is a definition only; the session gets it once attached", () => {
    const servers = enabledServers([{ presetId: "clickup", enabled: true, parameters: {} }]);
    expect(servers.map((server) => server.id)).toEqual(["clickup"]);
    expect(sessionConfig(servers, [])).toEqual(noMcp);
    const attached = sessionConfig(servers, [{ serverId: "clickup", target: { kind: "session" }, tools: null }]);
    expect(Object.keys(attached.mcpServers ?? {})).toEqual(["clickup"]);
  });

  it("reports enabled presets that fail validation or share a server id", () => {
    const result = renderEnabledMcpPresets([
      { presetId: "clickup", enabled: true, parameters: {} },
      { presetId: "clickup", enabled: true, parameters: {} },
      { presetId: "snowflake", enabled: true, parameters: {} },
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.error.map((error) => [error.presetId, error.issues.map((issue) => issue.parameter)])).toEqual([
      ["clickup", ["serverId"]],
      ["snowflake", ["accountUrl", "database", "schema", "server", "patSecretRef"]],
    ]);
  });
});
