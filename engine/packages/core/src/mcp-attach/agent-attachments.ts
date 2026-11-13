import type { AgentDef } from "@pica/protocol";
import { toolKind } from "../agents/tool-catalog.ts";
import type { McpAttachment } from "./types.ts";

// An agent that lists `server/tool` or `server/*` in its tools (C-02) attaches that server to
// itself, limited to the tools it names.
export function agentMcpAttachments(agents: readonly AgentDef[]): McpAttachment[] {
  return agents.flatMap((agent) => {
    const toolsByServer = new Map<string, string[] | null>();
    for (const tool of agent.tools) {
      if (toolKind(tool) !== "mcp") {
        continue;
      }
      const [serverId = "", name = ""] = tool.split("/");
      const current = toolsByServer.get(serverId);
      if (name === "*" || current === null) {
        toolsByServer.set(serverId, null);
      } else {
        toolsByServer.set(serverId, [...(current ?? []), name]);
      }
    }
    return [...toolsByServer].map(([serverId, tools]): McpAttachment => ({
      serverId,
      target: { kind: "agent", agent: agent.name },
      tools,
    }));
  });
}
