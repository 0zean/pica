import { describe, expect, it } from "vitest";
import { agentMcpAttachments, mcpSessionConfig } from "../../src/index.ts";
import type { McpAttachment, McpSessionConfig } from "../../src/index.ts";
import { agent, plan, readJson } from "./helpers.ts";

const agents = [
  agent("bulk-reader", ["view"]),
  agent("repo-scout", ["glob", "grep", "scripts/*", "view"]),
  agent("triage", ["view"]),
];

const attachments: readonly McpAttachment[] = [
  { serverId: "github", target: { kind: "session" }, tools: ["list_issues", "get_issue"] },
  { serverId: "datadog", target: { kind: "agent", agent: "triage" }, tools: ["search_logs"] },
  ...agentMcpAttachments(agents),
];

function serverIds(servers: McpSessionConfig["mcpServers"]): string[] {
  return Object.keys(servers ?? {});
}

describe("session config", () => {
  const config = mcpSessionConfig(plan(agents, attachments));

  it("matches the reviewed snapshot", () => {
    expect(config).toEqual(readJson("session-config.expected.json"));
  });

  it("puts a server scoped to one agent on that agent only", () => {
    expect(serverIds(config.mcpServers)).toEqual(["github"]);
    const holders = (id: string): string[] =>
      config.customAgents.filter((entry) => serverIds(entry.mcpServers).includes(id)).map((entry) => entry.name);
    expect(holders("datadog")).toEqual(["triage"]);
    expect(holders("scripts")).toEqual(["repo-scout"]);
    expect(holders("github")).toEqual([]);
  });

  it("leaves agents with nothing attached without an mcpServers key", () => {
    const bulkReader = config.customAgents.find((entry) => entry.name === "bulk-reader");
    expect(bulkReader).toEqual({ name: "bulk-reader" });
  });

  it("does not depend on attachment order", () => {
    const reversed = mcpSessionConfig(plan(agents, [...attachments].reverse()));
    expect(JSON.stringify(reversed)).toEqual(JSON.stringify(config));
  });
});
