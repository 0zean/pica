import { describe, expect, it } from "vitest";
import { agentLayerPrecedence, resolveAgents } from "@pica/core";
import type { AgentDocument } from "@pica/core";
import type { AgentDef } from "@pica/protocol";
import { agentDocument } from "./helpers.ts";

function resolved(documents: readonly AgentDocument[]): AgentDef[] {
  const result = resolveAgents(documents);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

const pairs = agentLayerPrecedence.flatMap((lower, index) =>
  agentLayerPrecedence.slice(index + 1).map((higher) => [lower, higher] as const),
);

describe("agent layer precedence", () => {
  it("orders the layers builtin, user, workspace, .github/agents, repo", () => {
    expect(agentLayerPrecedence).toEqual(["builtin", "user", "workspace", "github_agents", "repo"]);
  });

  it.each(pairs)("%s is overridden by %s, whatever the input order", (lower, higher) => {
    const documents = [agentDocument(lower, "shared"), agentDocument(higher, "shared")];
    for (const ordering of [documents, [...documents].reverse()]) {
      const [agent] = resolved(ordering);
      expect(agent?.sourceLayer).toBe(higher);
      expect(agent?.description).toBe(`shared from ${higher}`);
    }
  });

  it("replaces the whole definition rather than merging fields", () => {
    const lower = agentDocument("builtin", "shared", { tools: ["view", "grep"], tier: "reasoning" });
    const higher = agentDocument("repo", "shared", { tools: ["glob"] });
    const [agent] = resolved([lower, higher]);
    expect(agent).toMatchObject({ tools: ["glob"], tier: "worker", prompt: "Prompt for shared from repo." });
  });

  it("resolves an agent from every layer at once to the highest", () => {
    const documents = [...agentLayerPrecedence].reverse().map((layer) => agentDocument(layer, "shared"));
    expect(resolved(documents).map((agent) => agent.sourceLayer)).toEqual(["repo"]);
  });

  it("keeps agents that only a lower layer defines, sorted by name", () => {
    const documents = [
      agentDocument("builtin", "bulk-reader"),
      agentDocument("user", "zeta"),
      agentDocument("workspace", "alpha"),
      agentDocument("github_agents", "bulk-reader"),
    ];
    expect(resolved(documents).map((agent) => [agent.name, agent.sourceLayer])).toEqual([
      ["alpha", "workspace"],
      ["bulk-reader", "github_agents"],
      ["zeta", "user"],
    ]);
  });

  it("rejects the same agent twice in one layer, naming both files", () => {
    const first = agentDocument("repo", "dup");
    const second = { ...agentDocument("repo", "dup"), path: "/other-repo/dup.agent.md" };
    const result = resolveAgents([first, second]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues).toEqual([
        { file: "/other-repo/dup.agent.md", field: "name", message: expect.stringContaining("/repo/dup.md") as unknown },
      ]);
    }
  });

  it("records the source path, except for built-in agents", () => {
    const agents = resolved([agentDocument("builtin", "a"), agentDocument("user", "b")]);
    expect(agents.map((agent) => agent.sourcePath)).toEqual([null, "/user/b.md"]);
  });
});
