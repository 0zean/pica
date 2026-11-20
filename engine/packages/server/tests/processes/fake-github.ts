// The stub GitHub server `fake-picad.ts` starts when PICA_TEST_GITHUB is set (A-12), so the app's team
// browser can be tested with no network. `signed-in` serves three teams: acme/platform and acme/payments list
// their repos, and vault-corp/vault answers as a SAML SSO-protected organization does. `signed-out` has no
// credential at all, so every call answers `auth_required`.
import { ok, resolveGitHubHost } from "@pica/core";
import type { GitHubCredentialProvider } from "@pica/core";
import { startStubGitHub } from "../../../adapters/tests/github/stub-github.ts";
import type { StubGitHub, StubReply } from "../../../adapters/tests/github/stub-github.ts";
import type { GitHubAccessSettings } from "../../src/index.ts";

export type FakeGitHubMode = "signed-in" | "signed-out";

export const fakeGitHubToken = "stub-token";
export const fakeGitHubSsoUrl = "https://ghe.example.test/orgs/vault-corp/sso?authorization_request=stub";

const teams = [
  { org: "acme", slug: "platform", name: "Platform", repos: ["atlas", "beacon"] },
  { org: "acme", slug: "payments", name: "Payments", repos: ["ledger", "billing"] },
  { org: "vault-corp", slug: "vault", name: "Vault", repos: [] },
];

function repoBody(org: string, name: string): Record<string, unknown> {
  return {
    full_name: `${org}/${name}`,
    html_url: `https://ghe.example.test/${org}/${name}`,
    clone_url: `https://ghe.example.test/${org}/${name}.git`,
    default_branch: "main",
    archived: false,
    fork: false,
    topics: [],
  };
}

function routes(): Record<string, () => StubReply> {
  const table: Record<string, () => StubReply> = {
    "GET /api/v3/user": () => ({ headers: { "x-oauth-scopes": "repo, read:org" }, body: { login: "octo" } }),
    "GET /api/v3/user/teams?per_page=100": () => ({
      body: teams.map((team) => ({ slug: team.slug, name: team.name, organization: { login: team.org } })),
    }),
    "GET /api/v3/orgs/vault-corp/teams/vault/repos?per_page=100": () => ({
      status: 403,
      headers: { "x-github-sso": `required; url=${fakeGitHubSsoUrl}` },
      body: { message: "Resource protected by organization SAML enforcement." },
    }),
  };
  for (const team of teams.filter((entry) => entry.repos.length > 0)) {
    table[`GET /api/v3/orgs/${team.org}/teams/${team.slug}/repos?per_page=100`] = () => ({
      headers: { etag: `"${team.slug}-v1"` },
      body: team.repos.map((name) => repoBody(team.org, name)),
    });
  }
  return table;
}

export async function startFakeGitHub(mode: FakeGitHubMode): Promise<{ stub: StubGitHub; access: GitHubAccessSettings }> {
  const stub = await startStubGitHub(routes());
  const host = resolveGitHubHost({ host: "ghe.example.test", apiBaseUrl: `${stub.url}/api/v3`, webBaseUrl: "https://ghe.example.test" });
  const provider: GitHubCredentialProvider = {
    kind: "gh",
    token: () => Promise.resolve(ok(mode === "signed-in" ? fakeGitHubToken : null)),
  };
  return { stub, access: { host, providers: [provider] } };
}
