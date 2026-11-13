import { describe, expect, it } from "vitest";
import { mainAgentTools, provisionalBuiltinTools, routingProfileNames, toolKind } from "../../src/index.ts";

// Asserted against C-02's tool catalog, which is provisional until S-02 records the real names.
const createFileTools = provisionalBuiltinTools.filter((tool) => tool.createsFiles === true).map((tool) => tool.name);

describe("main-agent tools per profile", () => {
  it("the catalog names at least one create-file tool", () => {
    expect(createFileTools.length).toBeGreaterThan(0);
  });

  it("strict: the main agent has no write tool", () => {
    const tools = mainAgentTools("strict");
    expect(tools.filter((name) => toolKind(name) === "write")).toEqual([]);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("balanced: the main agent has no create-file tool but keeps its other write tools", () => {
    const tools = mainAgentTools("balanced");
    expect(tools.filter((name) => createFileTools.includes(name))).toEqual([]);
    expect(tools.some((name) => toolKind(name) === "write")).toBe(true);
  });

  it("off: the main agent has every built-in tool", () => {
    expect(mainAgentTools("off")).toEqual(provisionalBuiltinTools.map((tool) => tool.name).sort());
  });

  it.each(routingProfileNames)("%s: the tool list is sorted and free of duplicates", (profile) => {
    const tools = mainAgentTools(profile);
    expect(tools).toEqual([...new Set(tools)].sort());
  });
});
