import { describe, expect, it } from "vitest";
import type { AgentDef } from "@pica/protocol";
import { delegationGuide } from "../../src/index.ts";

const agent = (name: string): AgentDef => ({
  name,
  description: `${name} does one job.`,
  tier: "worker",
  tools: ["view"],
  prompt: "",
  sourceLayer: "user",
  sourcePath: null,
});

describe("delegation guide agent set", () => {
  it("lists user agents and names no missing built-in", () => {
    const guide = delegationGuide("balanced", [agent("zeta"), agent("alpha")]);
    expect(guide.indexOf("`alpha`")).toBeLessThan(guide.indexOf("`zeta`"));
    expect(guide).not.toMatch(/bulk-reader|code-writer|repo-scout/);
    expect(guide).toContain("You cannot create files. A patch with an `*** Add File` or `*** Move to` section is denied whole.\n");
  });

  it("states strict's write rule without code-writer", () => {
    const guide = delegationGuide("strict", []);
    expect(guide).toContain("None are available in this session.");
    expect(guide).toContain("You have no tools that write files.\n");
  });
});
