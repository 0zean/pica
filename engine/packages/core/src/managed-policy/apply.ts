import type { ConfigLayerInput, ResolvedConfig, ResolvedValue } from "../config/index.ts";
import type { JsonValue } from "../json.ts";
import type { BudgetSettings } from "../sessions/index.ts";
import type { PolicyContext } from "../policy/index.ts";
import type { ManagedPolicy, PermissionMode } from "./types.ts";

// The `managed` layer for `resolveConfig`: every key the policy's `config` section sets is locked.
export function managedConfigLayer(policy: ManagedPolicy | undefined): ConfigLayerInput[] {
  if (policy?.configLocks === undefined) {
    return [];
  }
  return [{ layer: "managed", source: policy.source, value: policy.configLocks }];
}

// Applies the ceilings and the permission floor to a resolved configuration. A value that had to
// change is reported as coming from the locked managed layer.
export function applyManagedPolicy(resolved: ResolvedConfig, policy: ManagedPolicy | undefined): ResolvedConfig {
  if (policy === undefined) {
    return resolved;
  }
  const { config } = resolved;
  const values = new Map(resolved.values);
  const sessionCredits = enforce(values, "budget.sessionCredits", config.budget.sessionCredits, (value) =>
    atMost(value, policy.budget.maxSessionCredits),
  );
  const workspaceDailyCredits = enforce(values, "budget.workspaceDailyCredits", config.budget.workspaceDailyCredits, (value) =>
    atMost(value, policy.budget.maxWorkspaceDailyCredits),
  );
  const mode = enforce(values, "permissions.mode", config.permissions.mode, (value) =>
    atLeastAsStrict(value, policy.minimumPermissionMode),
  );
  return {
    config: {
      ...config,
      budget: { ...config.budget, sessionCredits, workspaceDailyCredits },
      permissions: { ...config.permissions, mode },
    },
    values,
  };
}

// The policy pieces `decide` needs (C-03 managed rules, M-05 MCP allowlist).
export function managedPolicyContext(
  policy: ManagedPolicy | undefined,
): Pick<PolicyContext, "managed" | "managedMcpAllowlist"> {
  if (policy === undefined) {
    return { managed: [] };
  }
  return { managed: policy.rules, ...(policy.mcpAllowlist !== undefined && { managedMcpAllowlist: policy.mcpAllowlist }) };
}

// Budget settings for the session service with the session ceiling attached, so a per-session
// budget or an approved raise cannot exceed it either.
export function managedBudgetSettings(settings: BudgetSettings, policy: ManagedPolicy | undefined): BudgetSettings {
  const ceiling = policy?.budget.maxSessionCredits;
  return ceiling === undefined ? settings : { ...settings, maxSessionCredits: ceiling };
}

function enforce<T extends JsonValue>(
  values: Map<string, ResolvedValue>,
  keyPath: string,
  value: T,
  limit: (value: T) => T,
): T {
  const enforced = limit(value);
  if (enforced !== value) {
    values.set(keyPath, { keyPath, value: enforced, layer: "managed", locked: true });
  }
  return enforced;
}

function atMost(value: number, ceiling: number | undefined): number {
  return ceiling === undefined ? value : Math.min(value, ceiling);
}

const strictness: Readonly<Record<PermissionMode, number>> = { auto: 0, ask: 1 };

function atLeastAsStrict(mode: PermissionMode, floor: PermissionMode | undefined): PermissionMode {
  return floor !== undefined && strictness[mode] < strictness[floor] ? floor : mode;
}
