import { describe, expect, it } from "vitest";
import { defaultRoutingProfile, sessionDefaultProfile } from "../../src/index.ts";

// D-22: a session created without a profile gets the workspace's override, unless managed policy
// locks `routing.profile`; else the configured profile, which defaults to `off`.
describe("sessionDefaultProfile", () => {
  it.each([
    { name: "no override: the configured profile", configured: "off", locked: false, workspaceRouting: undefined, expected: "off" },
    { name: "a user config choice applies", configured: "strict", locked: false, workspaceRouting: {}, expected: "strict" },
    { name: "a workspace override wins over the user config", configured: "off", locked: false, workspaceRouting: { profile: "balanced" }, expected: "balanced" },
    { name: "a managed lock wins over the workspace", configured: "off", locked: true, workspaceRouting: { profile: "balanced" }, expected: "off" },
    { name: "an unknown override is ignored", configured: "off", locked: false, workspaceRouting: { profile: "fast" }, expected: "off" },
    { name: "a non-object routing layer is ignored", configured: "balanced", locked: false, workspaceRouting: "balanced", expected: "balanced" },
  ] as const)("$name", ({ configured, locked, workspaceRouting, expected }) => {
    expect(sessionDefaultProfile({ configured, locked, workspaceRouting })).toBe(expected);
  });

  it("the product default is off", () => {
    expect(defaultRoutingProfile).toBe("off");
  });
});
