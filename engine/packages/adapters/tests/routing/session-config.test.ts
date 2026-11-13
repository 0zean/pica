import { describe, expect, it } from "vitest";
import { routingProfileNames, routingSessionConfig } from "@pica/core";
import { builtinAgents } from "../agents/helpers.ts";

// The session config is the cached prompt prefix and tool set (PLAN.md §5.5): a change must be deliberate.
describe("routing session config", () => {
  it.each(routingProfileNames)("%s matches its snapshot", (profile) => {
    expect(routingSessionConfig(profile, builtinAgents())).toMatchSnapshot();
  });
});
