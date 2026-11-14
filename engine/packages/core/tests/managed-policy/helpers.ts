import type { ConfigLayerInput, ManagedPolicy, ResolvedConfig } from "../../src/index.ts";
import { applyManagedPolicy, compileManagedPolicy, managedConfigLayer, resolveConfig } from "../../src/index.ts";

export function managedPolicy(file: unknown): ManagedPolicy {
  const compiled = compileManagedPolicy("/Library/Application Support/Pica/policy.jsonc", file);
  if (!compiled.ok) {
    throw new Error(compiled.error.message);
  }
  return compiled.value;
}

// What the engine does at startup: user layers plus the policy's locks, then ceilings and floor.
export function resolveWithPolicy(layers: readonly ConfigLayerInput[], policy: ManagedPolicy): ResolvedConfig {
  const resolved = resolveConfig([...layers, ...managedConfigLayer(policy)]);
  if (!resolved.ok) {
    throw new Error(resolved.error.message);
  }
  return applyManagedPolicy(resolved.value, policy);
}

export function userLayer(value: unknown): ConfigLayerInput {
  return { layer: "user", source: "~/Library/Application Support/Pica/config.jsonc", value };
}
