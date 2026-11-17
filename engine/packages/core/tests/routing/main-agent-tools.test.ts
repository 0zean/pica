import { describe, expect, it } from "vitest";
import { builtinTools, mainAgentTools, routingProfileNames, toolKind } from "../../src/index.ts";

// Asserted against C-02's tool catalog, built from the tools S-02 observed.
const createFileTools = builtinTools.filter((tool) => tool.createsFiles === true).map((tool) => tool.name);
// The ones whose created files the engine sees and denies per call (C-11), so `balanced` keeps them.
const ungatedCreateFileTools = builtinTools.filter((tool) => tool.createsFiles === true && tool.createsGated !== true).map((tool) => tool.name);

describe("main-agent tools per profile", () => {
  it("the catalog names at least one create-file tool", () => {
    expect(createFileTools.length).toBeGreaterThan(0);
  });

  it("strict: the main agent has no write tool", () => {
    const tools = mainAgentTools("strict");
    expect(tools.filter((name) => toolKind(name) === "write")).toEqual([]);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("balanced: the main agent has no ungated create-file tool but keeps its other write tools", () => {
    const tools = mainAgentTools("balanced");
    expect(ungatedCreateFileTools.length).toBeGreaterThan(0);
    expect(tools.filter((name) => ungatedCreateFileTools.includes(name))).toEqual([]);
    expect(tools.some((name) => toolKind(name) === "write")).toBe(true);
  });

  it("balanced: apply_patch stays, since a patch that adds a file is denied per call (C-11)", () => {
    expect(mainAgentTools("balanced")).toContain("apply_patch");
    expect(mainAgentTools("balanced")).not.toContain("create");
    expect(mainAgentTools("strict")).not.toContain("apply_patch");
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
