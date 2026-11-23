import type { SessionModelTiers } from "../store/index.ts";
import type { SessionRoutingProfile } from "./info.ts";

// What managed policy (H-01) locks of a session's routing: the locked `routing.profile` and the
// locked `routing.tiers.<tier>` settings. A session may not choose another value for either.
export interface SessionRoutingLocks {
  readonly profile?: SessionRoutingProfile | undefined;
  readonly tiers?: SessionModelTiers | undefined;
  // The policy's id, for the refusal's message.
  readonly policyId?: string | undefined;
}

// What a request chooses; a part left out is not checked.
export interface SessionRoutingChoice {
  readonly routingProfile?: SessionRoutingProfile | undefined;
  readonly modelTiers?: SessionModelTiers | undefined;
}

// Drops tiers set to nothing, so "no overrides" is always `undefined`.
export function normalizeModelTiers(tiers: SessionModelTiers | undefined): SessionModelTiers | undefined {
  if (tiers === undefined) return undefined;
  const normalized: { reasoning?: string; worker?: string } = {};
  if (tiers.reasoning !== undefined && tiers.reasoning !== "") normalized.reasoning = tiers.reasoning;
  if (tiers.worker !== undefined && tiers.worker !== "") normalized.worker = tiers.worker;
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

// Why policy refuses the choice, or undefined when it allows it. Choosing the locked value is allowed.
export function lockedRoutingChoice(choice: SessionRoutingChoice, locks: SessionRoutingLocks | undefined): string | undefined {
  if (locks === undefined) return undefined;
  const by = locks.policyId === undefined ? "managed policy" : `managed policy ${JSON.stringify(locks.policyId)}`;
  if (locks.profile !== undefined && choice.routingProfile !== undefined && choice.routingProfile !== locks.profile) {
    return `routing.profile is locked to ${locks.profile} by ${by}`;
  }
  for (const tier of ["reasoning", "worker"] as const) {
    const locked = locks.tiers?.[tier];
    const chosen = choice.modelTiers?.[tier];
    if (locked !== undefined && chosen !== undefined && chosen !== locked) {
      return `routing.tiers.${tier} is locked to ${locked} by ${by}`;
    }
  }
  return undefined;
}
