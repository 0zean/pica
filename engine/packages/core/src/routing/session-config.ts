import type { AgentDef, Tier } from "@pica/protocol";
import { mainAgent } from "../policy/types.ts";
import { compareNames, delegationGuide } from "./delegation-guide.ts";
import { mainAgentTools, type RoutingProfileName } from "./profiles.ts";

export interface AgentToolVisibility {
  readonly name: string;
  readonly tier: Tier;
  /** Built-in tool names, sorted. MCP tools are attached separately (M-04). */
  readonly tools: readonly string[];
}

/** What a routing profile fixes at session start: tool sets and the delegation guide (PLAN.md §5.5). */
export interface RoutingSessionConfig {
  readonly profile: RoutingProfileName;
  readonly main: AgentToolVisibility;
  readonly agents: readonly AgentToolVisibility[];
  readonly delegationGuide: string;
}

export function routingSessionConfig(profile: RoutingProfileName, agents: readonly AgentDef[]): RoutingSessionConfig {
  return {
    profile,
    main: { name: mainAgent, tier: "reasoning", tools: mainAgentTools(profile) },
    agents: [...agents]
      .sort((a, b) => compareNames(a.name, b.name))
      .map((agent) => ({ name: agent.name, tier: agent.tier, tools: [...agent.tools].sort() })),
    delegationGuide: delegationGuide(profile, agents),
  };
}
