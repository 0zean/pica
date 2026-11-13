import { describe, expect, it } from "vitest";
import { agentMcpAttachments, estimateMcpPlanTokens, mcpSessionConfig, visibleMcpTools } from "../../src/index.ts";
import { agent, fixtureCatalog, plan } from "./helpers.ts";

// The registry defines github, datadog, and scripts, and the catalog knows all their tools,
// but nothing is attached.
const agents = [agent("bulk-reader", ["view"]), agent("repo-scout", ["glob", "grep", "view"])];
const empty = plan(agents, agentMcpAttachments(agents));
const catalog = fixtureCatalog();

describe("a session with no servers attached", () => {
  it("has no attached servers anywhere", () => {
    expect(empty.session).toEqual([]);
    expect(empty.agents.map((entry) => entry.servers)).toEqual([[], []]);
  });

  it("carries no MCP server config on the session or any agent", () => {
    expect(mcpSessionConfig(empty)).toEqual({ customAgents: [{ name: "bulk-reader" }, { name: "repo-scout" }] });
  });

  it("exposes no MCP tool definitions", () => {
    const targets = [empty.session, ...empty.agents.map((entry) => entry.servers)];
    const tools = targets.flatMap((servers) => servers.flatMap((server) => visibleMcpTools(server, catalog) ?? []));
    expect(tools).toEqual([]);
  });

  it("costs zero tool-definition tokens", () => {
    const estimate = estimateMcpPlanTokens(empty, catalog);
    expect(estimate.session).toEqual({ tokens: 0, complete: true, servers: [] });
    expect(estimate.agents.map((entry) => entry.estimate.tokens)).toEqual([0, 0]);
  });
});
