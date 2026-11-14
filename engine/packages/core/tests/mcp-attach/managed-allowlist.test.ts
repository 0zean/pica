import { describe, expect, it } from "vitest";
import type { ManagedMcpAllowlist, McpAttachment } from "../../src/index.ts";
import { attachMcpServers } from "../../src/index.ts";
import { registry } from "./helpers.ts";

const policy = (...servers: ManagedMcpAllowlist["servers"]): ManagedMcpAllowlist => ({ id: "org-mcp", servers });
const session = (serverId: string): McpAttachment => ({ serverId, target: { kind: "session" }, tools: null });

describe("managed MCP allowlist", () => {
  it("refuses a server absent from the allowlist and names the policy", () => {
    const result = attachMcpServers(registry, [], [session("scripts")], policy({ id: "github" }));
    if (result.ok) {
      throw new Error("expected the attachment to be refused");
    }
    expect(result.error.code).toBe("mcp_attach.invalid");
    expect(result.error.issues).toEqual([
      {
        code: "mcp_attach.not_in_managed_allowlist",
        serverId: "scripts",
        target: "session",
        policy: "managed:org-mcp",
        message: "not on the managed MCP allowlist (policy managed:org-mcp)",
      },
    ]);
    expect(result.error.message).toBe("session: scripts: not on the managed MCP allowlist (policy managed:org-mcp)");
  });

  it("refuses an agent-scoped attachment too", () => {
    const result = attachMcpServers(registry, ["triage"], [{ serverId: "datadog", target: { kind: "agent", agent: "triage" }, tools: null }], policy());
    expect(result.ok ? [] : result.error.issues.map((issue) => issue.code)).toEqual(["mcp_attach.not_in_managed_allowlist"]);
  });

  it("attaches servers on the allowlist", () => {
    const result = attachMcpServers(registry, [], [session("github"), session("datadog")], policy({ id: "github" }, { id: "datadog" }));
    expect(result.ok && result.value.session.map((server) => server.definition.id)).toEqual(["datadog", "github"]);
  });

  it("attaches anything when there is no managed allowlist", () => {
    expect(attachMcpServers(registry, [], [session("scripts")]).ok).toBe(true);
  });

  it.each([
    ["a matching url pin", { id: "github", url: "https://api.githubcopilot.com/mcp/" }, "github", true],
    ["a different url pin", { id: "github", url: "https://evil.example/mcp/" }, "github", false],
    ["a command pin on a remote server", { id: "github", command: "node" }, "github", false],
    ["a matching command pin", { id: "scripts", command: "node" }, "scripts", true],
    ["a different command pin", { id: "scripts", command: "python" }, "scripts", false],
    ["a url pin on a stdio server", { id: "scripts", url: "https://example.com/" }, "scripts", false],
  ] as const)("checks %s", (_label, entry, serverId, allowed) => {
    const result = attachMcpServers(registry, [], [session(serverId)], policy(entry));
    expect(result.ok).toBe(allowed);
    if (!result.ok) {
      expect(result.error.message).toBe(`session: ${serverId}: endpoint differs from the managed MCP allowlist entry (policy managed:org-mcp)`);
    }
  });
});
