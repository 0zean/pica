import { describe, expect, it } from "vitest";
import type { AgentDef } from "@pica/protocol";
import { routingProfileNames, routingSessionConfig } from "@pica/core";
import { builtinAgents } from "../agents/helpers.ts";

// Each session loads its agents afresh; the order the loader returns them in is not part of the contract.
function sessionGuide(profile: (typeof routingProfileNames)[number], order: "as-loaded" | "reversed"): Buffer {
  const agents: AgentDef[] = [...builtinAgents()];
  if (order === "reversed") {
    agents.reverse();
  }
  return Buffer.from(routingSessionConfig(profile, agents).delegationGuide, "utf8");
}

describe("delegation guide", () => {
  it.each(routingProfileNames)("%s is byte-identical across sessions", (profile) => {
    const first = sessionGuide(profile, "as-loaded");
    const second = sessionGuide(profile, "as-loaded");
    const third = sessionGuide(profile, "reversed");
    expect(first.equals(second)).toBe(true);
    expect(first.equals(third)).toBe(true);
  });

  it.each(routingProfileNames)("%s matches its golden file", async (profile) => {
    await expect(routingSessionConfig(profile, builtinAgents()).delegationGuide).toMatchFileSnapshot(
      `__golden__/delegation-guide.${profile}.md`,
    );
  });

  it("off has no guide; balanced and strict differ", () => {
    const guides = routingProfileNames.map((profile) => routingSessionConfig(profile, builtinAgents()).delegationGuide);
    expect(guides[0]).toBe("");
    expect(guides[1]).not.toBe(guides[2]);
  });
});
