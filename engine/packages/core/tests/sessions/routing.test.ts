import { describe, expect, it } from "vitest";
import { lockedRoutingChoice, normalizeModelTiers } from "../../src/sessions/routing.ts";

describe("session routing", () => {
  it("normalizes empty tier choices to none", () => {
    expect(normalizeModelTiers(undefined)).toBeUndefined();
    expect(normalizeModelTiers({})).toBeUndefined();
    expect(normalizeModelTiers({ reasoning: "", worker: "auto" })).toEqual({ worker: "auto" });
  });

  it("allows anything without locks, and the locked value itself", () => {
    expect(lockedRoutingChoice({ routingProfile: "strict", modelTiers: { reasoning: "m" } }, undefined)).toBeUndefined();
    const locks = { profile: "balanced" as const, tiers: { worker: "w" }, policyId: "acme" };
    expect(lockedRoutingChoice({ routingProfile: "balanced", modelTiers: { worker: "w", reasoning: "m" } }, locks)).toBeUndefined();
    expect(lockedRoutingChoice({}, locks)).toBeUndefined();
  });

  it("names the locked key and the policy when a choice differs", () => {
    const locks = { profile: "balanced" as const, tiers: { worker: "w" }, policyId: "acme" };
    expect(lockedRoutingChoice({ routingProfile: "off" }, locks)).toBe('routing.profile is locked to balanced by managed policy "acme"');
    expect(lockedRoutingChoice({ modelTiers: { worker: "auto" } }, locks)).toBe(
      'routing.tiers.worker is locked to w by managed policy "acme"',
    );
  });
});
