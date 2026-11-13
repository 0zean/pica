import type { McpServerDef, SecretRef } from "@pica/protocol";
import type { AttachedMcpServer, McpAttachmentPlan } from "./types.ts";

// The Copilot SDK's per-session and per-agent `mcpServers` entries. `tools` is the SDK's only
// filter, and `["*"]` means every tool. Secret references stay unresolved for M-03.
export type McpSessionServerConfig =
  | {
      readonly type: "local";
      readonly command: string;
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string | SecretRef>>;
      readonly cwd?: string;
      readonly tools: readonly string[];
    }
  | {
      readonly type: "http" | "sse";
      readonly url: string;
      readonly headers: Readonly<Record<string, string | SecretRef>>;
      readonly tools: readonly string[];
    };

export type McpSessionServers = Readonly<Record<string, McpSessionServerConfig>>;

export interface McpAgentSessionConfig {
  readonly name: string;
  readonly mcpServers?: McpSessionServers;
}

export interface McpSessionConfig {
  readonly mcpServers?: McpSessionServers;
  readonly customAgents: readonly McpAgentSessionConfig[];
}

// A target with nothing attached gets no `mcpServers` key at all, so no MCP tool definition
// reaches its context.
export function mcpSessionConfig(plan: McpAttachmentPlan): McpSessionConfig {
  const session = serverConfigs(plan.session);
  return {
    ...(session === undefined ? {} : { mcpServers: session }),
    customAgents: plan.agents.map((agent) => {
      const servers = serverConfigs(agent.servers);
      return servers === undefined ? { name: agent.agent } : { name: agent.agent, mcpServers: servers };
    }),
  };
}

function serverConfigs(servers: readonly AttachedMcpServer[]): McpSessionServers | undefined {
  if (servers.length === 0) {
    return undefined;
  }
  return Object.fromEntries(servers.map((server) => [server.definition.id, serverConfig(server)]));
}

function serverConfig(server: AttachedMcpServer): McpSessionServerConfig {
  const tools = server.tools ?? ["*"];
  const transport: McpServerDef["transport"] = server.definition.transport;
  if (transport.type === "stdio") {
    return {
      type: "local",
      command: transport.command,
      args: transport.args,
      env: transport.env,
      ...(transport.cwd === null ? {} : { cwd: transport.cwd }),
      tools,
    };
  }
  return { type: transport.type, url: transport.url, headers: transport.headers, tools };
}
