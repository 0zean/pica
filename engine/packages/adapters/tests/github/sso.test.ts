import { afterEach, describe, expect, it } from "vitest";
import { gitHubAuthErrorData, resolveGitHubCredential, ssoAuthorizationUrl } from "@pica/core";
import { ErrorData } from "@pica/protocol";
import {
  createGhCliCredentialProvider,
  createGitHubTokenVerifier,
  createPatCredentialProvider,
  createRpcGitHubSecretReader,
  gitHubGetJson,
} from "../../src/index.ts";
import { credentialRequest, fakeGh, fakeSecrets, startStubGitHub, stubHost, userRoute, type StubGitHub } from "./stub-github.ts";

const authorizationUrl = "https://ghe.example.test/orgs/acme/sso?authorization_request=A1B2C3";

let stub: StubGitHub | undefined;

afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe("SAML SSO", () => {
  it("maps a 403 with X-GitHub-SSO to auth_sso_required whose fix opens the authorization URL", async () => {
    stub = await startStubGitHub({
      "GET /api/v3/orgs/acme/teams": () => ({
        status: 403,
        headers: { "x-github-sso": `required; url=${authorizationUrl}`, "x-oauth-scopes": "repo, read:org" },
        body: { message: "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization." },
      }),
    });
    const result = await gitHubGetJson(stubHost(stub), "pat", "ghp_x", "/orgs/acme/teams");
    expect(result.ok).toBe(false);
    const data = ErrorData.parse(gitHubAuthErrorData(result.ok ? never() : result.error));
    expect(data.code).toBe("auth_sso_required");
    expect(data.fix).toEqual({ kind: "open_url", label: "Authorize for single sign-on", target: authorizationUrl });
  });

  it("reports the SSO error from the chain when verification hits SSO enforcement", async () => {
    stub = await startStubGitHub({
      "GET /api/v3/user": (request) =>
        request.authorization === "Bearer gho_cli"
          ? { status: 403, headers: { "x-github-sso": `required; url=${authorizationUrl}` }, body: { message: "SAML" } }
          : userRoute({})(request),
    });
    const result = await resolveGitHubCredential(
      [
        createGhCliCredentialProvider({ run: fakeGh("gho_cli").run }),
        createPatCredentialProvider(createRpcGitHubSecretReader(fakeSecrets({ "github/ghe.example.test/pat": "ghp_bad" }).call)),
      ],
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub)),
    );
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "auth_sso_required",
      fix: { kind: "open_url", target: authorizationUrl },
      details: { attempts: [{ provider: "gh", code: "auth_sso_required" }, { provider: "pat", code: "auth_required" }] },
    });
  });

  it("does not treat a 403 without the SSO header as an SSO error", async () => {
    stub = await startStubGitHub({
      "GET /api/v3/orgs/acme/teams": () => ({ status: 403, body: { message: "Must have admin rights to Repository." } }),
    });
    const result = await gitHubGetJson(stubHost(stub), "pat", "ghp_x", "/orgs/acme/teams");
    expect(result.ok ? undefined : result.error).toMatchObject({ code: "github_request_failed", details: { status: 403 } });
  });

  it("succeeds on a partial-results SSO header", async () => {
    stub = await startStubGitHub({
      "GET /api/v3/user/orgs": () => ({ headers: { "x-github-sso": "partial-results; organizations=21955855,20582480" }, body: [] }),
    });
    const result = await gitHubGetJson(stubHost(stub), "pat", "ghp_x", "/user/orgs");
    expect(result.ok).toBe(true);
  });

  it.each([
    [`required; url=${authorizationUrl}`, authorizationUrl],
    ["partial-results; organizations=1,2", undefined],
    ["required", undefined],
    [undefined, undefined],
  ])("reads the authorization URL from %s", (header, expected) => {
    expect(ssoAuthorizationUrl(header)).toBe(expected);
  });
});

function never(): never {
  throw new Error("expected a failure");
}
