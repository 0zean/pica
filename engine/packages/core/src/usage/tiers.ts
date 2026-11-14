import type { Tier } from "@pica/protocol";

export interface AgentTierSource {
  readonly rootAgent: string;
  readonly agents?: readonly { readonly name: string; readonly tier: Tier }[];
}

// The root agent is reasoning-tier (PLAN.md §5.2). Any other agent takes its definition's tier,
// and an agent without one is a worker, as an agent file without a `tier` is.
export function agentTier(source: AgentTierSource): (agent: string) => Tier {
  const tiers = new Map((source.agents ?? []).map((agent) => [agent.name, agent.tier]));
  return (agent) => (agent === source.rootAgent ? "reasoning" : (tiers.get(agent) ?? "worker"));
}
