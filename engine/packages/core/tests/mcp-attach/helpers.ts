import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef, McpServerDef } from "@pica/protocol";
import { attachMcpServers } from "../../src/index.ts";
import type { McpAttachment, McpAttachmentPlan, McpToolCatalog, McpToolDefinition } from "../../src/index.ts";

export const fixturesDir = join(import.meta.dirname, "fixtures");

export const registry: readonly McpServerDef[] = [
  {
    id: "github",
    name: "GitHub",
    scope: "global",
    toolAllowlist: null,
    transport: {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: { secretRef: "keychain:github/pat" } },
    },
  },
  {
    id: "datadog",
    name: "Datadog",
    scope: "workspace",
    toolAllowlist: ["get_monitor", "search_logs"],
    transport: { type: "sse", url: "https://mcp.datadoghq.com/sse", headers: {} },
  },
  {
    id: "scripts",
    name: "scripts",
    scope: "repo",
    toolAllowlist: null,
    transport: { type: "stdio", command: "node", args: ["server.js"], env: { TOKEN: { secretRef: "env:SCRIPTS_TOKEN" } }, cwd: null },
  },
];

export function agent(name: string, tools: readonly string[]): AgentDef {
  return { name, description: name, tier: "worker", tools: [...tools], prompt: "", sourceLayer: "builtin", sourcePath: null };
}

export function plan(agents: readonly AgentDef[], attachments: readonly McpAttachment[]): McpAttachmentPlan {
  const result = attachMcpServers(
    registry,
    agents.map((entry) => entry.name),
    attachments,
  );
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as unknown;
}

// fixtures/tools/<server>.json holds each server's `tools/list` result.
export function fixtureCatalog(): McpToolCatalog {
  const files = readdirSync(join(fixturesDir, "tools")).filter((file) => file.endsWith(".json"));
  return Object.fromEntries(
    files.map((file) => [file.slice(0, -".json".length), readJson(join("tools", file)) as McpToolDefinition[]]),
  );
}
