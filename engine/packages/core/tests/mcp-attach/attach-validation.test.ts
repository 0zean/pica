import { describe, expect, it } from "vitest";
import { agentMcpAttachments, attachMcpServers } from "../../src/index.ts";
import type { McpAttachment, McpAttachmentIssueCode } from "../../src/index.ts";
import { agent, plan, registry } from "./helpers.ts";

function issueCodes(attachments: readonly McpAttachment[]): McpAttachmentIssueCode[] {
  const result = attachMcpServers(registry, ["triage"], attachments);
  if (result.ok) {
    throw new Error("expected the attachments to be rejected");
  }
  expect(result.error.code).toBe("mcp_attach.invalid");
  return result.error.issues.map((issue) => issue.code);
}

describe("attachment validation", () => {
  it("rejects an unknown server", () => {
    expect(issueCodes([{ serverId: "jira", target: { kind: "session" }, tools: null }])).toEqual(["mcp_attach.unknown_server"]);
  });

  it("rejects an unknown agent", () => {
    expect(issueCodes([{ serverId: "github", target: { kind: "agent", agent: "ghost" }, tools: null }])).toEqual([
      "mcp_attach.unknown_agent",
    ]);
  });

  it("rejects a tool outside the server's allowlist and names it", () => {
    const result = attachMcpServers(registry, [], [{ serverId: "datadog", target: { kind: "session" }, tools: ["delete_monitor"] }]);
    expect(result.ok ? "" : result.error.message).toBe("session: datadog: not in the server's tool allowlist: delete_monitor");
  });

  it("rejects an empty allowlist", () => {
    expect(issueCodes([{ serverId: "github", target: { kind: "session" }, tools: [] }])).toEqual(["mcp_attach.empty_allowlist"]);
  });

  it("reports every problem at once", () => {
    expect(
      issueCodes([
        { serverId: "jira", target: { kind: "session" }, tools: null },
        { serverId: "github", target: { kind: "session" }, tools: [] },
      ]),
    ).toEqual(["mcp_attach.unknown_server", "mcp_attach.empty_allowlist"]);
  });
});

describe("allowlists", () => {
  it("inherits the server's allowlist when the attachment names none", () => {
    const result = plan([], [{ serverId: "datadog", target: { kind: "session" }, tools: null }]);
    expect(result.session.map((server) => server.tools)).toEqual([["get_monitor", "search_logs"]]);
  });

  it("joins tool lists when a server is attached twice to one target", () => {
    const result = plan(
      [agent("triage", ["github/get_issue"])],
      [
        { serverId: "github", target: { kind: "agent", agent: "triage" }, tools: ["list_issues"] },
        ...agentMcpAttachments([agent("triage", ["github/get_issue"])]),
      ],
    );
    expect(result.agents[0]?.servers.map((server) => server.tools)).toEqual([["get_issue", "list_issues"]]);
  });

  it("lets `server/*` in an agent's tools mean every tool", () => {
    expect(agentMcpAttachments([agent("a", ["github/get_issue", "github/*", "view"])])).toEqual([
      { serverId: "github", target: { kind: "agent", agent: "a" }, tools: null },
    ]);
  });
});
