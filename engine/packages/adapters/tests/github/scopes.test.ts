import { afterEach, describe, expect, it } from "vitest";
import { gitHubAuthErrorData, gitHubHasScope, resolveGitHubCredential, type GitHubCredentialProvider } from "@pica/core";
import { ErrorData } from "@pica/protocol";
import {
  createGhCliCredentialProvider,
  createGitHubTokenVerifier,
  createPatCredentialProvider,
  createRpcGitHubSecretReader,
  gitHubGetJson,
} from "../../src/index.ts";
import { credentialRequest, fakeGh, fakeSecrets, startStubGitHub, stubHost, userRoute, type StubGitHub } from "./stub-github.ts";

let stub: StubGitHub | undefined;

afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const teamsAccepted = { "x-accepted-oauth-scopes": "admin:org, write:org, read:org" };

describe("missing read:org", () => {
  it("maps a 403 whose X-OAuth-Scopes covers none of X-Accepted-OAuth-Scopes to a scope error naming read:org", async () => {
    stub = await startStubGitHub({
      "GET /api/v3/orgs/acme/teams": () => ({
        status: 403,
        headers: { ...teamsAccepted, "x-oauth-scopes": "repo, gist" },
        body: { message: "Resource not accessible by personal access token" },
      }),
    });
    const result = await gitHubGetJson(stubHost(stub), "pat", "ghp_x", "/orgs/acme/teams");
    const error = result.ok ? undefined : result.error;
    expect(error?.code).toBe("auth_scope_missing");
    expect(error?.message).toContain("read:org");
    expect(error?.details).toMatchObject({ scope: "read:org", grantedScopes: ["repo", "gist"] });
    expect(ErrorData.parse(gitHubAuthErrorData(error ?? never())).fix).toEqual({
      kind: "open_url",
      label: "Add read:org to the token",
      target: `${stub.url}/settings/tokens`,
    });
  });

  it("maps a 404 for a token without the accepted scope the same way", async () => {
    stub = await startStubGitHub({
      "GET /api/v3/orgs/acme/teams/core/repos": () => ({ status: 404, headers: { ...teamsAccepted, "x-oauth-scopes": "" } }),
    });
    const result = await gitHubGetJson(stubHost(stub), "gh", "gho_x", "/orgs/acme/teams/core/repos");
    expect(result.ok ? undefined : result.error).toMatchObject({ code: "auth_scope_missing", details: { scope: "read:org" } });
  });

  it("does not blame scopes when the token holds a scope that implies read:org", async () => {
    stub = await startStubGitHub({
      "GET /api/v3/orgs/acme/teams": () => ({ status: 403, headers: { ...teamsAccepted, "x-oauth-scopes": "admin:org" } }),
    });
    const result = await gitHubGetJson(stubHost(stub), "pat", "ghp_x", "/orgs/acme/teams");
    expect(result.ok ? undefined : result.error.code).toBe("github_request_failed");
  });

  it("refuses a gh token without read:org when the caller requires it, offering gh auth refresh", async () => {
    stub = await startStubGitHub({ "GET /api/v3/user": userRoute({ gho_cli: { login: "octo", scopes: "repo, gist" } }) });
    const providers: GitHubCredentialProvider[] = [createGhCliCredentialProvider({ run: fakeGh("gho_cli").run })];
    const result = await resolveGitHubCredential(
      providers,
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub), { scopes: ["repo", "read:org"] }),
    );
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "auth_scope_missing",
      message: "The GitHub token for ghe.example.test is missing the read:org scope.",
      fix: { kind: "run_command", target: "gh auth refresh --hostname ghe.example.test --scopes read:org" },
      details: { scope: "read:org", attempts: [{ provider: "gh", outcome: "rejected", code: "auth_scope_missing" }] },
    });
  });

  it("prefers the scope error over a later provider's sign-in error", async () => {
    stub = await startStubGitHub({ "GET /api/v3/user": userRoute({ gho_cli: { login: "octo", scopes: "repo" } }) });
    const result = await resolveGitHubCredential(
      [
        createGhCliCredentialProvider({ run: fakeGh("gho_cli").run }),
        createPatCredentialProvider(createRpcGitHubSecretReader(fakeSecrets({}).call)),
      ],
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub), { scopes: ["read:org"] }),
    );
    expect(result.ok ? undefined : result.error.code).toBe("auth_scope_missing");
  });

  it("accepts a token whose scopes GitHub does not report, such as a fine-grained PAT", async () => {
    stub = await startStubGitHub({ "GET /api/v3/user": userRoute({ github_pat_fine: { login: "octo" } }) });
    const result = await resolveGitHubCredential(
      [createPatCredentialProvider(createRpcGitHubSecretReader(fakeSecrets({ "github/ghe.example.test/pat": "github_pat_fine" }).call))],
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub), { scopes: ["read:org"] }),
    );
    expect(result.ok ? result.value.scopes : result.error).toBeNull();
  });

  it.each([
    [["read:org"], true],
    [["write:org"], true],
    [["admin:org"], true],
    [["repo", "user"], false],
  ])("treats %j as covering read:org: %s", (granted, expected) => {
    expect(gitHubHasScope(granted, "read:org")).toBe(expected);
  });
});

function never(): never {
  throw new Error("expected a failure");
}
