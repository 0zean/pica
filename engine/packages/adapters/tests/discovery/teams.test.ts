import { afterEach, describe, expect, it } from "vitest";
import { listOrganizations, listOrgProperties, listTeams, selectorForSource } from "@pica/core";
import { listingRoutes, startDiscoveryStub, type DiscoveryStub } from "./stub-listing.ts";

let running: DiscoveryStub | undefined;

afterEach(async () => {
  await running?.stub.close();
  running = undefined;
});

const ssoUrl = "https://ghe.example.test/orgs/acme/sso?authorization_request=Z9";

describe("organizations and teams", () => {
  it("lists organizations and teams with their organization", async () => {
    const teams = Array.from({ length: 130 }, (_, index) => ({
      slug: `team-${String(index)}`,
      name: `Team ${String(index)}`,
      organization: { login: index % 2 === 0 ? "acme" : "globex" },
    }));
    running = await startDiscoveryStub((stub) => ({
      ...listingRoutes(stub, "/user/orgs?per_page=100", { items: [{ login: "acme" }, { login: "globex" }], etag: '"o"' }),
      ...listingRoutes(stub, "/user/teams?per_page=100", { items: teams, etag: '"t"' }),
    }));
    const orgs = await listOrganizations(running.client);
    expect(orgs.ok ? orgs.value : orgs.error).toEqual([{ login: "acme" }, { login: "globex" }]);
    const listed = await listTeams(running.client);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value).toHaveLength(130);
    expect(listed.value[1]).toEqual({ org: "globex", slug: "team-1", name: "Team 1" });
  });

  it("lists an organization's custom property definitions", async () => {
    running = await startDiscoveryStub(() => ({
      "GET /api/v3/orgs/acme/properties/schema": () => ({
        body: [
          { property_name: "team", value_type: "single_select", allowed_values: ["payments", "frontend"] },
          { property_name: "tier", value_type: "string" },
        ],
      }),
    }));
    const result = await listOrgProperties(running.client, "acme");
    expect(result.ok ? result.value : result.error).toEqual([
      { name: "team", valueType: "single_select", allowedValues: ["payments", "frontend"] },
      { name: "tier", valueType: "string", allowedValues: [] },
    ]);
  });

  it("passes the SSO error from /user/teams through with its authorization URL", async () => {
    running = await startDiscoveryStub(() => ({
      "GET /api/v3/user/teams?per_page=100": () => ({
        status: 403,
        headers: { "x-github-sso": `required; url=${ssoUrl}` },
        body: { message: "Resource protected by organization SAML enforcement." },
      }),
    }));
    const result = await listTeams(running.client);
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "auth_sso_required",
      fix: { kind: "open_url", target: ssoUrl },
    });
  });

  it("reports a missing read:org scope from /user/teams", async () => {
    running = await startDiscoveryStub(() => ({
      "GET /api/v3/user/teams?per_page=100": () => ({
        status: 403,
        headers: { "x-oauth-scopes": "repo", "x-accepted-oauth-scopes": "read:org, admin:org" },
        body: { message: "Must have admin rights" },
      }),
    }));
    const result = await listTeams(running.client);
    expect(result.ok ? undefined : result.error).toMatchObject({ code: "auth_scope_missing", details: { scope: "read:org" } });
  });

  it("refuses to send the token to a pagination URL on another host", async () => {
    running = await startDiscoveryStub(() => ({
      "GET /api/v3/user/orgs?per_page=100": () => ({
        headers: { link: '<https://evil.test/api/v3/user/orgs?page=2>; rel="next"' },
        body: [{ login: "acme" }],
      }),
    }));
    const result = await listOrganizations(running.client);
    expect(result.ok ? undefined : result.error.code).toBe("github_request_failed");
    expect(running.stub.requests).toHaveLength(1);
  });
});

describe("selectorForSource", () => {
  it("maps each discoverable kind", () => {
    expect(selectorForSource({ kind: "team", org: "acme", selector: "platform" })).toEqual({
      ok: true,
      value: { kind: "team", org: "acme", teamSlug: "platform" },
    });
    expect(selectorForSource({ kind: "topic", org: "acme", selector: "Payments" })).toEqual({
      ok: true,
      value: { kind: "topic", org: "acme", topic: "payments" },
    });
    expect(selectorForSource({ kind: "property", org: "acme", selector: "team = payments" })).toEqual({
      ok: true,
      value: { kind: "property", org: "acme", name: "team", value: "payments" },
    });
  });

  it("rejects manual sources, a missing org, and malformed property selectors", () => {
    for (const source of [
      { kind: "manual", org: null, selector: "x" },
      { kind: "team", org: null, selector: "platform" },
      { kind: "property", org: "acme", selector: "team" },
      { kind: "property", org: "acme", selector: "=payments" },
    ] as const) {
      const result = selectorForSource(source);
      expect(result.ok ? undefined : result.error.code).toBe("invalid_params");
    }
  });
});
