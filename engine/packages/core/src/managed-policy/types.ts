import type { PicaConfig } from "@pica/protocol";
import type { JsonObject } from "../json.ts";
import type { ManagedModelPolicy } from "../models/index.ts";
import type { ManagedMcpAllowlist, ManagedRule } from "../policy/index.ts";

export type PermissionMode = PicaConfig["permissions"]["mode"];

export interface BudgetCeilings {
  readonly maxSessionCredits?: number | undefined;
  readonly maxWorkspaceDailyCredits?: number | undefined;
}

// The organization policy compiled from a `ManagedPolicyFile` (protocol).
export interface ManagedPolicy {
  readonly id: string;
  readonly source: string;
  readonly models: ManagedModelPolicy;
  readonly mcpAllowlist?: ManagedMcpAllowlist | undefined;
  readonly budget: BudgetCeilings;
  readonly minimumPermissionMode?: PermissionMode | undefined;
  readonly rules: readonly ManagedRule[];
  // X-02: kinds of agents, skills and instruction files Pica may not write.
  readonly lockedCustomizations?: readonly ("agent" | "skill" | "instructions")[] | undefined;
  // Config keys to lock, as written; passed to `resolveConfig` as the `managed` layer.
  readonly configLocks?: JsonObject | undefined;
}
