import { resolveWorkspaceConfig, type ConfigLayerInput, type ResolvedConfig } from "@pica/core";
import { afterEach, describe, expect, it } from "vitest";
import { value } from "../repo-registry/helpers.ts";
import { createWorkspaceFixture, noDiscovery, type WorkspaceFixture } from "./helpers.ts";

let fixture: WorkspaceFixture | undefined;

afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

const user: ConfigLayerInput = {
  layer: "user",
  source: "user.jsonc",
  value: { routing: { profile: "off" }, budget: { sessionCredits: 100, workspaceDailyCredits: 1000 } },
};
const repo: ConfigLayerInput = { layer: "repo", source: "repo.jsonc", value: { budget: { sessionCredits: 300 } } };
const managed: ConfigLayerInput = { layer: "managed", source: "managed.jsonc", value: { permissions: { mode: "ask" } } };

function origin(resolved: ResolvedConfig, keyPath: string): [unknown, string] {
  const found = resolved.values.get(keyPath);
  return [found?.value, found?.layer ?? "missing"];
}

describe("workspace overrides", () => {
  it("resolve between the user and repo layers, under managed locks", () => {
    fixture = createWorkspaceFixture(noDiscovery);
    const { workspaces } = fixture;
    const id = value(workspaces.create("Payments")).id;
    value(
      workspaces.update(id, {
        settingsOverrides: {
          routing: { profile: "strict" },
          budget: { sessionCredits: 200, workspaceDailyCredits: 2000 },
          permissions: { mode: "auto" },
        },
      }),
    );
    const workspace = value(workspaces.get(id));

    const resolved = value(resolveWorkspaceConfig(workspace, [managed, repo, user]));

    expect(origin(resolved, "routing.profile")).toEqual(["strict", "workspace"]);
    expect(origin(resolved, "budget.workspaceDailyCredits")).toEqual([2000, "workspace"]);
    expect(origin(resolved, "budget.sessionCredits")).toEqual([300, "repo"]);
    expect(origin(resolved, "permissions.mode")).toEqual(["ask", "managed"]);
    expect(origin(resolved, "routing.tiers.worker")).toEqual(["auto", "default"]);
    expect(resolved.config.routing.profile).toBe("strict");
  });

  it("fall back to lower layers for keys the workspace does not set", () => {
    fixture = createWorkspaceFixture(noDiscovery);
    const workspace = value(fixture.workspaces.create("Payments"));

    const resolved = value(resolveWorkspaceConfig(workspace, [user]));

    expect(origin(resolved, "routing.profile")).toEqual(["off", "user"]);
    expect(origin(resolved, "budget.sessionCredits")).toEqual([100, "user"]);
  });

  it("replace any other workspace layer passed in", () => {
    fixture = createWorkspaceFixture(noDiscovery);
    const id = value(fixture.workspaces.create("Payments")).id;
    value(fixture.workspaces.update(id, { settingsOverrides: { routing: { profile: "strict" } } }));
    const stale: ConfigLayerInput = { layer: "workspace", source: "workspace:old", value: { routing: { profile: "off" } } };

    const resolved = value(resolveWorkspaceConfig(value(fixture.workspaces.get(id)), [stale]));

    expect(origin(resolved, "routing.profile")).toEqual(["strict", "workspace"]);
  });

  it("are validated against the config schema before they are saved", () => {
    fixture = createWorkspaceFixture(noDiscovery);
    const id = value(fixture.workspaces.create("Payments")).id;

    const updated = fixture.workspaces.update(id, { settingsOverrides: { routing: { profile: "fast" }, budjet: {} } });

    expect(updated.ok ? undefined : updated.error.code).toBe("workspace.invalid");
    expect(updated.ok ? "" : updated.error.message).toContain("budjet");
    expect(value(fixture.workspaces.get(id)).settingsOverrides).toEqual({});
  });
});
