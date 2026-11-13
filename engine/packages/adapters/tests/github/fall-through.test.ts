import { afterEach, describe, expect, it } from "vitest";
import { gitHubProviderOrder, resolveGitHubCredential, type GitHubCredentialProvider } from "@pica/core";
import {
  createDeviceFlowCredentialProvider,
  createGhCliCredentialProvider,
  createGitHubTokenVerifier,
  createPatCredentialProvider,
  createRpcGitHubSecretReader,
} from "../../src/index.ts";
import {
  credentialRequest,
  fakeGh,
  fakeSecrets,
  startStubGitHub,
  stubHost,
  userRoute,
  type StubGitHub,
} from "./stub-github.ts";

let stub: StubGitHub | undefined;

afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

interface ChainSetup {
  readonly gh: ReturnType<typeof fakeGh>;
  readonly secrets: ReturnType<typeof fakeSecrets>;
  readonly deviceToken?: string;
}

function chain(setup: ChainSetup): GitHubCredentialProvider[] {
  return [
    createGhCliCredentialProvider({ run: setup.gh.run }),
    createDeviceFlowCredentialProvider({ present: () => undefined, sleep: () => Promise.resolve() }),
    createPatCredentialProvider(createRpcGitHubSecretReader(setup.secrets.call)),
  ];
}

async function startStub(): Promise<StubGitHub> {
  return startStubGitHub({
    "GET /api/v3/user": userRoute({
      gho_cli: { login: "cli-user", scopes: "repo, read:org" },
      gho_device: { login: "device-user", scopes: "repo, read:org" },
      ghp_pat: { login: "pat-user", scopes: "repo, admin:org" },
    }),
    "POST /login/device/code": () => ({
      body: { device_code: "d", user_code: "U-1", verification_uri: "https://ghe.example.test/login/device", expires_in: 60, interval: 1 },
    }),
    "POST /login/oauth/access_token": () => ({ body: { access_token: "gho_device" } }),
  });
}

describe("provider chain", () => {
  it("tries gh, then device flow, then a PAT", () => {
    const providers = chain({ gh: fakeGh("logged_out"), secrets: fakeSecrets({}) });
    expect(providers.map((provider) => provider.kind)).toEqual(gitHubProviderOrder);
  });

  it("uses the gh token first and never asks the secret broker", async () => {
    stub = await startStub();
    const secrets = fakeSecrets({ "github/ghe.example.test/pat": "ghp_pat" });
    const result = await resolveGitHubCredential(
      chain({ gh: fakeGh("gho_cli"), secrets }),
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub, { oauthClientId: "Iv1.client" }), { interactive: true }),
    );
    expect(result).toEqual({
      ok: true,
      value: { host: "ghe.example.test", provider: "gh", token: "gho_cli", login: "cli-user", scopes: ["repo", "read:org"] },
    });
    expect(secrets.refs).toEqual([]);
    expect(stub.requests.map((request) => request.path)).toEqual(["/api/v3/user"]);
  });

  it("falls through to the device flow when gh is logged out and the request is interactive", async () => {
    stub = await startStub();
    const secrets = fakeSecrets({ "github/ghe.example.test/pat": "ghp_pat" });
    const result = await resolveGitHubCredential(
      chain({ gh: fakeGh("logged_out"), secrets }),
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub, { oauthClientId: "Iv1.client" }), { interactive: true }),
    );
    expect(result.ok ? result.value.provider : result.error).toBe("device_flow");
    expect(secrets.refs).toEqual([]);
  });

  it("falls through to the PAT when gh is not installed and the request is not interactive", async () => {
    stub = await startStub();
    const secrets = fakeSecrets({ "github/ghe.example.test/pat": "ghp_pat" });
    const result = await resolveGitHubCredential(
      chain({ gh: fakeGh("not_installed"), secrets }),
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub, { oauthClientId: "Iv1.client" })),
    );
    expect(result.ok ? result.value : result.error).toMatchObject({ provider: "pat", login: "pat-user" });
    expect(stub.requests.map((request) => request.path)).toEqual(["/api/v3/user"]);
  });

  it("falls through when the gh token is rejected by the server", async () => {
    stub = await startStub();
    const result = await resolveGitHubCredential(
      chain({ gh: fakeGh("gho_revoked"), secrets: fakeSecrets({ "github/ghe.example.test/pat": "ghp_pat" }) }),
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub)),
    );
    expect(result.ok ? result.value.provider : result.error).toBe("pat");
    expect(stub.requests.map((request) => request.authorization)).toEqual(["Bearer gho_revoked", "Bearer ghp_pat"]);
  });

  it("skips a token without the required scope and takes the next one that has it", async () => {
    stub = await startStub();
    const result = await resolveGitHubCredential(
      chain({ gh: fakeGh("gho_cli"), secrets: fakeSecrets({ "github/ghe.example.test/pat": "ghp_pat" }) }),
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub), { scopes: ["admin:org"] }),
    );
    expect(result.ok ? result.value.provider : result.error).toBe("pat");
  });

  it("asks the user to sign in when no provider has a token, listing each attempt", async () => {
    stub = await startStub();
    const result = await resolveGitHubCredential(
      chain({ gh: fakeGh("logged_out"), secrets: fakeSecrets({}) }),
      createGitHubTokenVerifier(),
      credentialRequest(stubHost(stub)),
    );
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "auth_required",
      fix: { kind: "sign_in", target: "ghe.example.test" },
      details: {
        attempts: [
          { provider: "gh", outcome: "unavailable" },
          { provider: "device_flow", outcome: "unavailable" },
          { provider: "pat", outcome: "unavailable" },
        ],
      },
    });
    expect(stub.requests).toEqual([]);
  });
});
