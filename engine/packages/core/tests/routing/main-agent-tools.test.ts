import { describe, expect, it } from "vitest";
import { builtinTools, mainAgentTools, routingProfileNames, toolKind } from "../../src/index.ts";

// Asserted against C-02's tool catalog, built from the tools S-02 observed.
const createFileTools = builtinTools.filter((tool) => tool.createsFiles === true).map((tool) => tool.name);

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

  it("balanced: apply_patch is hidden with create, since a patch can add files (S-04)", () => {
    expect(mainAgentTools("balanced")).not.toContain("apply_patch");
    expect(toolKind("rg")).toBe("search");
  });

  it("off: the main agent has every built-in tool", () => {
    expect(mainAgentTools("off")).toEqual(builtinTools.map((tool) => tool.name).sort());
  });

  it.each(routingProfileNames)("%s: the tool list is sorted and free of duplicates", (profile) => {
    const tools = mainAgentTools(profile);
    expect(tools).toEqual([...new Set(tools)].sort());
  });
});
