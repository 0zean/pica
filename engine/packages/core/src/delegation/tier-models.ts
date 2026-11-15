import type { Tier } from "@pica/protocol";
import type { ModelCatalog } from "../models/catalog.ts";
import { resolveTier } from "../models/tiers.ts";
import type { TierResolution, TierSettingsInput } from "../models/tiers.ts";
import type { ManagedModelPolicy } from "../models/types.ts";

// Resolves a tier against the current model catalog. Without a catalog snapshot no model is listed,
// so the tier is `unresolved` and the runtime's default model applies, as on a default-model-only plan.
export function catalogTierResolver(
  catalog: Pick<ModelCatalog, "get">,
  settings: () => TierSettingsInput,
  policy: () => ManagedModelPolicy,
): (tier: Tier) => Promise<TierResolution> {
  return async (tier) => {
    const snapshot = await catalog.get();
    const models = snapshot.ok ? snapshot.value.models : [];
    return resolveTier(tier, settings()[tier], models, policy());
  };
}
