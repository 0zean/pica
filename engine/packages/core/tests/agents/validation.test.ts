import { describe, expect, it } from "vitest";
import { agentName, resolveAgents, validateAgent } from "@pica/core";
import type { AgentIssue } from "@pica/core";
import { agentDocument } from "./helpers.ts";

function issues(frontmatter: Record<string, unknown>, body?: string): AgentIssue[] {
  const result = validateAgent(agentDocument("repo", "agent", frontmatter, body));
  return result.ok ? [] : [...result.error];
}

function fields(frontmatter: Record<string, unknown>, body?: string): string[] {
  return issues(frontmatter, body).map((issue) => issue.field);
}

describe("agent validation", () => {
  it("names the field of an unknown tool", () => {
    expect(issues({ tools: ["view", "teleport"] })).toEqual([
      { file: "/repo/agent.md", field: "tools[1]", message: 'unknown tool "teleport"' },
    ]);
  });

  it("names the field of an unknown tier", () => {
    expect(issues({ tier: "frontier" })).toEqual([
      {
        file: "/repo/agent.md",
        field: "tier",
        message: 'unknown tier "frontier"; expected one of reasoning, worker',
      },
    ]);
  });

  it("fails the whole resolution with the field in the message", () => {
    const result = resolveAgents([agentDocument("user", "bad", { tier: 3, tools: ["nope"] })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("agents.invalid");
      expect(result.error.message).toBe(
        '/user/bad.md: tier: unknown tier 3; expected one of reasoning, worker\n/user/bad.md: tools[0]: unknown tool "nope"',
      );
    }
  });

  it.each([
    [{ description: "" }, "description"],
    [{ description: undefined }, "description"],
    [{ tools: undefined }, "tools"],
    [{ tools: [] }, "tools"],
    [{ tools: ["*"] }, "tools[0]"],
    [{ tools: [42] }, "tools[0]"],
    [{ colour: "blue" }, "colour"],
  ])("rejects %j at %s", (frontmatter, field) => {
    expect(fields(frontmatter)).toEqual([field]);
  });

  it("requires a prompt in the body", () => {
    expect(fields({}, "  \n")).toEqual(["prompt"]);
  });

  it("rejects frontmatter that is not a mapping", () => {
    const result = validateAgent({ layer: "user", path: "/u/a.md", frontmatter: ["x"], body: "p" });
    expect(result.ok ? [] : result.error.map((issue) => issue.field)).toEqual(["", "description", "tools"]);
  });

  it("defaults the tier to worker", () => {
    const result = validateAgent(agentDocument("repo", "agent", { tier: undefined }));
    expect(result.ok && result.value.tier).toBe("worker");
  });

  it("accepts and ignores Copilot fields Pica does not use", () => {
    expect(fields({ name: "Display", model: "gpt-x", target: "vscode", "user-invocable": false })).toEqual([]);
  });

  it("accepts a comma-separated tool string and MCP tool references", () => {
    const result = validateAgent(agentDocument("repo", "agent", { tools: "grep, github/*, view" }));
    expect(result.ok && result.value.tools).toEqual(["github/*", "grep", "view"]);
  });

  it("expands Copilot aliases with alias meaning in .github/agents", () => {
    const result = validateAgent(agentDocument("github_agents", "agent", { tools: ["read", "edit", "Grep"] }));
    expect(result.ok && result.value.tools).toEqual(["apply_patch", "create", "edit", "glob", "grep", "rg", "view"]);
  });

  it("accepts the todo alias, which has no tool on this runtime", () => {
    const result = validateAgent(agentDocument("github_agents", "agent", { tools: ["read", "todo"] }));
    expect(result.ok && result.value.tools).toEqual(["view"]);
  });

  it("prefers exact tool names in Pica layers", () => {
    const result = validateAgent(agentDocument("repo", "agent", { tools: ["edit", "grep", "read"] }));
    expect(result.ok && result.value.tools).toEqual(["edit", "grep", "view"]);
  });

  it("takes the name from the file", () => {
    expect(agentName("/r/.github/agents/bulk-reader.agent.md")).toBe("bulk-reader");
    expect(agentName("/r/.pica/agents/repo-scout.md")).toBe("repo-scout");
    expect(fields({}, "p")).toEqual([]);
    const bad = validateAgent({ ...agentDocument("repo", "x"), path: "/r/-bad name.md" });
    expect(bad.ok ? [] : bad.error.map((issue) => issue.field)).toEqual(["name"]);
  });
});
