import type { RuntimeMcpServers, SessionOptions } from "../runtime/index.ts";
import type { Session } from "../store/index.ts";

export interface SessionMcpOptions {
  readonly mcpServers?: RuntimeMcpServers;
  // By agent name.
  readonly agents: Readonly<Record<string, RuntimeMcpServers>>;
}

// A-13: the MCP servers attached to a session. `seed` runs once, when the session is created.
export interface SessionMcp {
  seed(session: Session): void;
  options(session: Session): Promise<SessionMcpOptions>;
}

type AgentOptions = Pick<SessionOptions, "customAgents">;

// Agent-scoped servers join the delegator's agent of the same name; an agent the session does not
// have gets none.
export function withMcpServers<T extends AgentOptions>(options: T, mcp: SessionMcpOptions): T & Pick<SessionOptions, "mcpServers"> {
  const customAgents = options.customAgents?.map((agent) => {
    const servers = mcp.agents[agent.name];
    return servers === undefined ? agent : { ...agent, mcpServers: servers };
  });
  return {
    ...options,
    ...(customAgents === undefined ? {} : { customAgents }),
    ...(mcp.mcpServers === undefined ? {} : { mcpServers: mcp.mcpServers }),
  };
}
