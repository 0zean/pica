import { JsoncConfigLoader, ManagedPolicyLoader, managedPolicyCandidates, userConfigPath } from "@pica/adapters";
import type { ConfigSource } from "@pica/adapters";
import { applyManagedPolicy } from "@pica/core";
import type { ManagedPolicy, ResolvedConfig } from "@pica/core";
import type { PicaConfig } from "@pica/protocol";
import type { Logger } from "./logger.ts";

export interface EngineConfig {
  readonly policy: ManagedPolicy | undefined;
  // The config as last loaded without error. Each call re-reads the files, so an edit applies to
  // running sessions; an edit that does not validate is logged and the previous config is kept.
  readonly current: () => PicaConfig;
  // The same, with the layer each key came from (`config.get`, A-14).
  readonly resolved: () => ResolvedConfig;
  // Where `config.set` writes the user layer.
  readonly userFile: string;
}

export interface EngineConfigOptions {
  readonly homeDir: string;
  readonly userName: string;
  readonly log: Logger;
  // Tests replace the candidates; production reads managed preferences and the root-owned file (H-01).
  readonly managedPolicy?: ManagedPolicyLoader | undefined;
}

// The user layer and the managed policy. Workspace and repo layers apply per session (follow-up).
export function loadEngineConfig(options: EngineConfigOptions): EngineConfig {
  const policy = loadManagedPolicy(options);
  const userFile = userConfigPath(options.homeDir);
  const sources: ConfigSource[] = [{ layer: "user", file: userFile }];
  if (policy?.configLocks !== undefined) {
    sources.push({ layer: "managed", label: policy.source, value: policy.configLocks });
  }
  const loader = new JsoncConfigLoader(sources);
  const read = (): ResolvedConfig | string => {
    const loaded = loader.load();
    return loaded.ok ? applyManagedPolicy(loaded.value, policy) : loaded.error.message;
  };
  const first = read();
  if (typeof first === "string") {
    throw new Error(`configuration: ${first}`);
  }
  let lastGood = first;
  let lastError: string | undefined;
  const resolved = (): ResolvedConfig => {
    const next = read();
    if (typeof next === "string") {
      if (next !== lastError) options.log.warn(`configuration not reloaded: ${next}`);
      lastError = next;
      return lastGood;
    }
    lastError = undefined;
    lastGood = next;
    return next;
  };
  return { policy, current: () => resolved().config, resolved, userFile };
}

function loadManagedPolicy(options: EngineConfigOptions): ManagedPolicy | undefined {
  const loader = options.managedPolicy ?? new ManagedPolicyLoader(managedPolicyCandidates(options.userName));
  const loaded = loader.load();
  if (!loaded.ok) {
    throw new Error(`managed policy: ${loaded.error.message}`);
  }
  for (const warning of loaded.value.warnings) {
    options.log.warn(warning.message);
  }
  return loaded.value.policy;
}
