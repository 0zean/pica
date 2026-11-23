import type { Tier } from "@pica/protocol";
import type { AgentLoader } from "../agents/port.ts";
import { builtinTools } from "../agents/tool-catalog.ts";
import type { TierResolution } from "../models/tiers.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { routingSessionConfig } from "../routing/session-config.ts";
import type { CustomAgentDefinition } from "../runtime/port.ts";
import type { DelegatedAgent, DelegationError, DelegationRequest, DelegationSetup, Delegator } from "./port.ts";

export interface RuntimeNativeDelegatorDeps {
  readonly agents: AgentLoader;
  // C-01's resolution of a tier, from `setting` when the session sets one, else from the config;
  // `resolvedModelId: null` leaves the agent on the runtime's default.
  readonly resolveTier: (tier: Tier, setting?: string) => Promise<TierResolution>;
}

// D-08: sub-agents are the runtime's `customAgents`, one per resolved agent definition. Each gets
// exactly its definition's tools and its tier's model, and no `model` when the tier resolves to none.
// The main agent runs on the reasoning tier's model the same way; without one the runtime's default
// model applies. A session's own tier settings (`modelTiers`) replace the config's for that session.
// It also loses the tools its routing profile hides (C-05) and gets the profile's
// delegation guide; under `off` it gets neither.
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
      const resolved = async (tier: Tier): Promise<TierResolution> => {
        const known = resolutions.get(tier) ?? (await deps.resolveTier(tier, request.modelTiers?.[tier]));
        resolutions.set(tier, known);
        return known;
      };
      const agents: DelegatedAgent[] = [];
      const customAgents: CustomAgentDefinition[] = [];
      for (const visible of routing.agents) {
        const definition = byName.get(visible.name);
        if (definition === undefined) {
          continue;
        }
        const resolution = await resolved(visible.tier);
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
      const excludedTools = builtinTools.map((tool) => tool.name).filter((name) => !routing.main.tools.includes(name)).sort();
      const main = await resolved(routing.main.tier);
      return ok({
        mode: "runtime_native",
        agents,
        sessionOptions: {
          customAgents,
          ...(main.resolvedModelId === null ? {} : { model: main.resolvedModelId }),
          ...(excludedTools.length === 0 ? {} : { excludedTools }),
          ...(routing.delegationGuide === "" ? {} : { systemMessage: routing.delegationGuide }),
        },
      });
    },
  };
}
