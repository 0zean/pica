import { layerPrecedence } from "@pica/core";
import type { ConfigLayerName, ResolvedConfig, ResolvedValue } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { MethodRouter } from "./router.ts";

// A-14: what the Settings scene and the composer's tier picker read and write (docs/settings.md).
// Only the user layer is composed (workspace and repo layers apply per session, a follow-up), so
// `workspaceId` and `repoId` are not used yet and `config.set` writes only the user layer.
export type ConfigWrite = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface EngineConfigAccess {
  readonly resolved: () => ResolvedConfig;
  readonly policyId: string | undefined;
  readonly setUserValue: (keyPath: string, value: unknown) => ConfigWrite;
}

interface ConfigValueDto {
  readonly keyPath: string;
  readonly value: unknown;
  readonly layer: ConfigLayerName;
  readonly locked: boolean;
  readonly lockedBy?: string;
}

export function registerConfigHandlers(router: MethodRouter, access: EngineConfigAccess): void {
  router.register("config.get", ({ keyPath }) => ({ value: describeKey(access, keyPath) }));

  router.register("config.set", ({ keyPath, value, layer }) => {
    if (layer !== "user") {
      throw new RpcFailure("invalid_params", `config.set writes only the user layer for now, not ${layer}`);
    }
    const locked = relatedValues(access.resolved(), keyPath).find((entry) => entry.locked);
    if (locked !== undefined) {
      throw new RpcFailure("policy_denied", `${locked.keyPath} is locked by ${policyName(access)}`, {
        keyPath: locked.keyPath,
        ...(access.policyId !== undefined && { policy: access.policyId }),
      });
    }
    const written = access.setUserValue(keyPath, value);
    if (!written.ok) {
      throw new RpcFailure("config_invalid", written.message, { keyPath });
    }
    return { ok: true as const };
  });
}

function describeKey(access: EngineConfigAccess, keyPath: string): ConfigValueDto {
  const resolved = access.resolved();
  const value = valueAt(resolved.config, keyPath);
  if (value === undefined) {
    throw new RpcFailure("not_found", `no config key ${keyPath}`, { keyPath });
  }
  // A key holding an object is reported from its leaves: the highest layer, locked if any is.
  const leaves = relatedValues(resolved, keyPath).filter((entry) => entry.keyPath === keyPath || entry.keyPath.startsWith(`${keyPath}.`));
  const layer = leaves.reduce<ConfigLayerName>((highest, entry) => (rank(entry.layer) > rank(highest) ? entry.layer : highest), "default");
  const locked = leaves.some((entry) => entry.locked);
  return {
    keyPath,
    value,
    layer,
    locked,
    ...(locked && access.policyId !== undefined && { lockedBy: access.policyId }),
  };
}

// The key itself, the keys under it, and the keys above it.
function relatedValues(resolved: ResolvedConfig, keyPath: string): ResolvedValue[] {
  return [...resolved.values.values()].filter(
    (entry) =>
      entry.keyPath === keyPath || entry.keyPath.startsWith(`${keyPath}.`) || keyPath.startsWith(`${entry.keyPath}.`),
  );
}

function valueAt(config: unknown, keyPath: string): unknown {
  let node: unknown = config;
  for (const key of keyPath.split(".")) {
    if (typeof node !== "object" || node === null || Array.isArray(node) || !Object.hasOwn(node, key)) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function rank(layer: ConfigLayerName): number {
  return layer === "managed" ? layerPrecedence.length : layerPrecedence.indexOf(layer);
}

function policyName(access: EngineConfigAccess): string {
  return access.policyId === undefined ? "managed policy" : `managed policy ${access.policyId}`;
}
