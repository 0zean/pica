import type { Tier } from "@pica/protocol";
import type { AgentLoader } from "../agents/port.ts";
import type { TierResolution } from "../models/tiers.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { routingSessionConfig } from "../routing/session-config.ts";
import type { CustomAgentDefinition } from "../runtime/port.ts";
import type { DelegatedAgent, DelegationError, DelegationRequest, DelegationSetup, Delegator } from "./port.ts";

export interface RuntimeNativeDelegatorDeps {
  readonly agents: AgentLoader;
  // C-01's resolution of a tier; `resolvedModelId: null` leaves the agent on the runtime's default.
  readonly resolveTier: (tier: Tier) => Promise<TierResolution>;
}

// D-08: sub-agents are the runtime's `customAgents`, one per resolved agent definition. Each gets
// exactly its definition's tools and its tier's model, and no `model` when the tier resolves to none.
export function createRuntimeNativeDelegator(deps: RuntimeNativeDelegatorDeps): Delegator {
  return {
    async setup(request: DelegationRequest): Promise<Result<DelegationSetup, DelegationError>> {
      const loaded = deps.agents.load();
      if (!loaded.ok) {
        return err({ code: "delegation.agents_invalid", message: `agent definitions: ${loaded.error.message}` });
      }
      const routing = routingSessionConfig(request.routingProfile, loaded.value);
      const byName = new Map(loaded.value.map((agent) => [agent.name, agent]));
      const resolutions = new Map<Tier, TierResolution>();
      const agents: DelegatedAgent[] = [];
      const customAgents: CustomAgentDefinition[] = [];
      for (const visible of routing.agents) {
        const definition = byName.get(visible.name);
        if (definition === undefined) {
          continue;
        }
        let resolution = resolutions.get(visible.tier);
        if (resolution === undefined) {
          resolution = await deps.resolveTier(visible.tier);
          resolutions.set(visible.tier, resolution);
        }
        const model = resolution.resolvedModelId;
        agents.push({ name: visible.name, tier: visible.tier, tools: visible.tools, model, modelReason: resolution.reason });
        customAgents.push({
          name: definition.name,
          description: definition.description,
          prompt: definition.prompt,
          tools: [...visible.tools],
          ...(model === null ? {} : { model }),
        });
      }
      return ok({ mode: "runtime_native", agents, sessionOptions: { customAgents } });
    },
  };
}
