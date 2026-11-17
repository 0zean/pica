import { isModelAllowed, resolveTiers } from "@pica/core";
import type { ManagedModelPolicy, ModelCatalog, TierSettingsInput } from "@pica/core";
import type { AgentDef } from "@pica/protocol";
import { RpcFailure } from "./errors.ts";
import type { MethodRouter } from "./router.ts";

// A-06: what the composer completes and picks from, served from the catalog and agents the
// sessions already use.
export interface EngineCatalogOptions {
  readonly catalog: ModelCatalog;
  // The agents sessions are built with: built-in and the user's. Workspace and repo agent layers
  // are not composed yet, so `agents.list` ignores its `workspaceId` and `repoId`.
  readonly agents: () => readonly AgentDef[];
  readonly tiers: () => TierSettingsInput;
  readonly models: ManagedModelPolicy;
}

export function registerCatalogHandlers(router: MethodRouter, options: EngineCatalogOptions): void {
  router.register("agents.list", () => ({ agents: [...options.agents()] }));

  router.register("models.list", async () => {
    const snapshot = await options.catalog.get();
    if (!snapshot.ok) {
      throw new RpcFailure("internal_error", snapshot.error.message, { reason: snapshot.error.code });
    }
    return {
      models: snapshot.value.models.map((model) => ({
        id: model.id,
        name: model.name,
        prices: model.prices,
        allowedByPolicy: isModelAllowed(model.id, options.models),
      })),
      fetchedAt: snapshot.value.fetchedAt,
    };
  });

  router.register("models.tiers", async () => {
    const snapshot = await options.catalog.get();
    const models = snapshot.ok ? snapshot.value.models : [];
    return {
      tiers: resolveTiers(options.tiers(), models, options.models).map((resolution) => ({
        tier: resolution.tier,
        setting: resolution.setting,
        resolvedModelId: resolution.resolvedModelId,
      })),
    };
  });
}
