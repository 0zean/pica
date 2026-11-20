import type { McpServerDef } from "@pica/protocol";
import type { AttachedMcpServer, McpAttachmentPlan } from "../mcp-attach/types.ts";
import type { McpSecretRedactor } from "../mcp-auth/redact.ts";
import { resolveMcpServerSecrets } from "../mcp-auth/resolve-secrets.ts";
import type { McpServerLaunch } from "../mcp-auth/resolve-secrets.ts";
import type { McpSecretSources } from "../mcp-auth/secret-source.ts";
import type { RuntimeMcpServer, RuntimeMcpServers } from "../runtime/index.ts";

// Adds what a server needs beyond its definition before it is started, such as an OAuth bearer
// token (M-03). Returns the launch unchanged when there is nothing to add.
export type McpLaunchAuthorizer = (definition: McpServerDef, launch: McpServerLaunch) => Promise<McpServerLaunch>;

export interface RuntimeMcpDeps {
  readonly sources: McpSecretSources;
  readonly redactor: McpSecretRedactor;
  readonly authorize?: McpLaunchAuthorizer;
  // A server whose secrets cannot be read is left out of the session, which still starts.
  readonly onSkipped: (serverId: string, message: string) => void;
}

export interface RuntimeMcpOptions {
  readonly mcpServers?: RuntimeMcpServers;
  // By agent name; only agents with servers appear.
  readonly agents: Readonly<Record<string, RuntimeMcpServers>>;
}

// The plan with every secret reference substituted. It holds secrets: it goes to the runtime only.
export async function runtimeMcpOptions(plan: McpAttachmentPlan, deps: RuntimeMcpDeps): Promise<RuntimeMcpOptions> {
  const session = await resolveAll(plan.session, deps);
  const agents: Record<string, RuntimeMcpServers> = {};
  for (const agent of plan.agents) {
    const servers = await resolveAll(agent.servers, deps);
    if (servers !== undefined) {
      agents[agent.agent] = servers;
    }
  }
  return session === undefined ? { agents } : { mcpServers: session, agents };
}

async function resolveAll(servers: readonly AttachedMcpServer[], deps: RuntimeMcpDeps): Promise<RuntimeMcpServers | undefined> {
  const resolved: Record<string, RuntimeMcpServer> = {};
  for (const server of servers) {
    const launch = await resolveMcpServerSecrets(server.definition, deps.sources, deps.redactor);
    if (!launch.ok) {
      deps.onSkipped(server.definition.id, launch.error.message);
      continue;
    }
    const authorized = deps.authorize === undefined ? launch.value : await deps.authorize(server.definition, launch.value);
    resolved[server.definition.id] = runtimeServer(authorized, server.tools ?? ["*"]);
  }
  return Object.keys(resolved).length === 0 ? undefined : resolved;
}

function runtimeServer(launch: McpServerLaunch, tools: readonly string[]): RuntimeMcpServer {
  const transport = launch.transport;
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
