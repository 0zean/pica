import type { ConfigError } from "../config/index.ts";
import type { Result } from "../result.ts";
import type { ManagedPolicy } from "./types.ts";

export type ManagedPolicyWarningCode = "managed_policy.untrusted_file" | "managed_policy.shadowed";

// Shaped like the protocol's `engine.warning` notification, less the timestamp.
export interface ManagedPolicyWarning {
  readonly code: ManagedPolicyWarningCode;
  readonly message: string;
}

export interface LoadedManagedPolicy {
  // Absent when no trusted policy source exists.
  readonly policy: ManagedPolicy | undefined;
  readonly warnings: readonly ManagedPolicyWarning[];
}

// A trusted policy that fails to parse is an error rather than an absent policy, so a broken
// policy never silently lifts the organization's restrictions.
export interface ManagedPolicySource {
  load(): Result<LoadedManagedPolicy, ConfigError>;
}
