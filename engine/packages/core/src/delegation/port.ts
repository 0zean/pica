import type { Tier } from "@pica/protocol";
import type { TierResolutionReason } from "../models/tiers.ts";
import type { Result } from "../result.ts";
import type { RoutingProfileName } from "../routing/profiles.ts";
import type { SessionOptions } from "../runtime/port.ts";

// How a session's sub-agents run (D-08):
// - `runtime_native`: the runtime's own `customAgents`; the main agent delegates through `task`.
// - `child_session`: the engine runs each delegation as its own runtime session with an explicit
//   model. The fallback for plans that list models but ignore the per-agent `model` override
//   (D-16, S-03 A4). Not implemented yet: see PLAN.md §10, C-07 follow-up.
export type DelegationMode = "runtime_native" | "child_session";

export interface DelegationRequest {
  readonly sessionId: string;
  readonly routingProfile: RoutingProfileName;
}

// One agent the main agent can delegate to, as configured for the session.
export interface DelegatedAgent {
  readonly name: string;
  readonly tier: Tier;
  // Exactly the agent definition's tools (C-02), sorted.
  readonly tools: readonly string[];
  // The model requested for the agent: its tier's resolved model, or null when the tier resolves
  // to none (default-model-only plans, D-16), in which case no model is requested and the runtime
  // picks. What actually ran is the model on the agent's `assistant.usage` events.
  readonly model: string | null;
  readonly modelReason: TierResolutionReason;
}

export interface DelegationSetup {
  readonly mode: DelegationMode;
  readonly agents: readonly DelegatedAgent[];
  // Spread into the runtime's `createSession` / `resumeSession` options.
  readonly sessionOptions: Pick<SessionOptions, "customAgents">;
}

export type DelegationErrorCode = "delegation.agents_invalid" | "delegation.invalid_profile";

export interface DelegationError {
  readonly code: DelegationErrorCode;
  readonly message: string;
}

// Decides how a session delegates and what its sub-agents get. Never throws.
export interface Delegator {
  setup(request: DelegationRequest): Promise<Result<DelegationSetup, DelegationError>>;
}
