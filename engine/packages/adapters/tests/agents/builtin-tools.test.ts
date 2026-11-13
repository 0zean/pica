import { describe, expect, it } from "vitest";
import { provisionalBuiltinTools, toolKind } from "@pica/core";
import { builtinAgent, builtinAgents } from "./helpers.ts";

// TODO(S-02): asserted against the provisional tool list until docs/spikes/S-02-tools.json exists.
const forbiddenForReaders = new Set(["write", "shell"]);

describe("built-in agent tools", () => {
  it("ships exactly bulk-reader, code-writer and repo-scout", () => {
    expect(builtinAgents().map((agent) => agent.name)).toEqual(["bulk-reader", "code-writer", "repo-scout"]);
  });

  it("checks against a tool list that has write and shell tools to find", () => {
    const kinds = new Set(provisionalBuiltinTools.map((tool) => tool.kind));
    expect(kinds.has("write") && kinds.has("shell")).toBe(true);
  });

  it.each(["bulk-reader", "repo-scout"])("%s has no write or shell tool", (name) => {
    const agent = builtinAgent(name);
    expect(agent.tools.length).toBeGreaterThan(0);
    for (const tool of agent.tools) {
      const kind = toolKind(tool);
      expect(kind, tool).toBeDefined();
      expect(kind === "mcp" || forbiddenForReaders.has(kind ?? ""), tool).toBe(false);
    }
  });

  it("code-writer can read and write but not run commands", () => {
    const kinds = new Set(builtinAgent("code-writer").tools.map(toolKind));
    expect(kinds.has("read") && kinds.has("write")).toBe(true);
    expect(kinds.has("shell")).toBe(false);
  });

  it("puts every built-in agent on the worker tier", () => {
    expect(builtinAgents().map((agent) => agent.tier)).toEqual(["worker", "worker", "worker"]);
  });
});
