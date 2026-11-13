import { afterEach, describe, expect, it } from "vitest";
import { resolveGitHubHost } from "@pica/core";
import {
  createDeviceFlowCredentialProvider,
  createGhCliCredentialProvider,
  createGitHubTokenVerifier,
  createPatCredentialProvider,
  createRpcGitHubSecretReader,
  type DeviceCodePrompt,
} from "../../src/index.ts";
import {
  credentialRequest,
  fakeGh,
  fakeSecrets,
  startStubGitHub,
  stubHost,
  userRoute,
  type StubGitHub,
  type StubReply,
} from "./stub-github.ts";

let stub: StubGitHub | undefined;

afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe("host configuration", () => {
  it("uses api.github.com for github.com", () => {
    const host = resolveGitHubHost({ host: "GitHub.com" });
    expect(host).toEqual({
      host: "github.com",
      webBaseUrl: "https://github.com",
      apiBaseUrl: "https://api.github.com",
      oauthClientId: null,
      patSecretRef: "github/github.com/pat",
    });
  });

  it("uses /api/v3 on the instance for GitHub Enterprise Server", () => {
    expect(resolveGitHubHost({ host: "ghe.corp.example" }).apiBaseUrl).toBe("https://ghe.corp.example/api/v3");
  });

  it("honours a custom API base URL and trims its trailing slash", () => {
    const host = resolveGitHubHost({ host: "ghe.corp.example", apiBaseUrl: "https://api.ghe.corp.example/", oauthClientId: "Iv1.abc" });
    expect(host.apiBaseUrl).toBe("https://api.ghe.corp.example");
    expect(host.webBaseUrl).toBe("https://ghe.corp.example");
    expect(host.oauthClientId).toBe("Iv1.abc");
  });

  it("sends API requests to the configured base URL", async () => {
    stub = await startStubGitHub({ "GET /api/v3/user": userRoute({ t1: { login: "octo", scopes: "repo, read:org" } }) });
    const verified = await createGitHubTokenVerifier().verify(stubHost(stub), "pat", "t1");
    expect(verified).toEqual({ ok: true, value: { login: "octo", scopes: ["repo", "read:org"] } });
    expect(stub.requests.map((request) => `${request.method} ${request.path}`)).toEqual(["GET /api/v3/user"]);
    expect(stub.requests[0]?.authorization).toBe("Bearer t1");
  });

  it("reports scopes as unknown when GitHub sends no X-OAuth-Scopes header", async () => {
    stub = await startStubGitHub({ "GET /api/v3/user": userRoute({ fine: { login: "octo" } }) });
    const verified = await createGitHubTokenVerifier().verify(stubHost(stub), "pat", "fine");
    expect(verified).toEqual({ ok: true, value: { login: "octo", scopes: null } });
  });
});

describe("gh CLI provider", () => {
  it("asks gh for the token of the requested host", async () => {
    const gh = fakeGh("gho_cli");
    const host = resolveGitHubHost({ host: "ghe.corp.example" });
    const token = await createGhCliCredentialProvider({ run: gh.run }).token(credentialRequest(host));
    expect(token).toEqual({ ok: true, value: "gho_cli" });
    expect(gh.calls).toEqual([["gh", "auth", "token", "--hostname", "ghe.corp.example"]]);
  });

  it.each(["logged_out", "not_installed"] as const)("has nothing to offer when gh is %s", async (state) => {
    const provider = createGhCliCredentialProvider({ run: fakeGh(state).run });
    const token = await provider.token(credentialRequest(resolveGitHubHost({ host: "github.com" })));
    expect(token).toEqual({ ok: true, value: null });
  });
});

describe("PAT provider", () => {
  it("reads the host's secret reference through secrets.get", async () => {
    const secrets = fakeSecrets({ "github/github.com/pat": "ghp_stored" });
    const provider = createPatCredentialProvider(createRpcGitHubSecretReader(secrets.call));
    const token = await provider.token(credentialRequest(resolveGitHubHost({ host: "github.com" })));
    expect(token).toEqual({ ok: true, value: "ghp_stored" });
    expect(secrets.refs).toEqual(["github/github.com/pat"]);
  });

  it("uses a configured secret reference", async () => {
    const secrets = fakeSecrets({ "team-ghe-token": "ghp_team" });
    const provider = createPatCredentialProvider(createRpcGitHubSecretReader(secrets.call));
    const host = resolveGitHubHost({ host: "ghe.corp.example", patSecretRef: "team-ghe-token" });
    expect(await provider.token(credentialRequest(host))).toEqual({ ok: true, value: "ghp_team" });
  });

  it("has nothing to offer when no secret is stored", async () => {
    const provider = createPatCredentialProvider(createRpcGitHubSecretReader(fakeSecrets({}).call));
    const token = await provider.token(credentialRequest(resolveGitHubHost({ host: "github.com" })));
    expect(token).toEqual({ ok: true, value: null });
  });

  it("reports a client failure as secret_unresolved", async () => {
    const reader = createRpcGitHubSecretReader(() =>
      Promise.resolve({ ok: false, code: "internal_error", message: "keychain locked" }),
    );
    const result = await reader.read("github/github.com/pat");
    expect(result.ok ? undefined : result.error.code).toBe("secret_unresolved");
  });

  it("rejects a malformed secrets.get result", async () => {
    const reader = createRpcGitHubSecretReader(() => Promise.resolve({ ok: true, result: { token: "x" } }));
    const result = await reader.read("github/github.com/pat");
    expect(result.ok ? undefined : result.error.code).toBe("secret_unresolved");
  });
});

describe("device flow provider", () => {
  function deviceRoutes(pollReplies: StubReply[]) {
    let polls = 0;
    return {
      "POST /login/device/code": (): StubReply => ({
        body: { device_code: "dev-1", user_code: "ABCD-1234", verification_uri: "https://ghe.example.test/login/device", expires_in: 900, interval: 5 },
      }),
      "POST /login/oauth/access_token": (): StubReply => {
        const reply = pollReplies[Math.min(polls, pollReplies.length - 1)] ?? {};
        polls += 1;
        return reply;
      },
    };
  }

  function provider(prompts: DeviceCodePrompt[], waits: number[]) {
    return createDeviceFlowCredentialProvider({
      present: (prompt) => prompts.push(prompt),
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
  }

  it("shows the user code and polls until GitHub issues a token", async () => {
    stub = await startStubGitHub(
      deviceRoutes([
        { body: { error: "authorization_pending" } },
        { body: { error: "slow_down", interval: 10 } },
        { body: { access_token: "gho_device", token_type: "bearer", scope: "repo read:org" } },
      ]),
    );
    const prompts: DeviceCodePrompt[] = [];
    const waits: number[] = [];
    const host = stubHost(stub, { oauthClientId: "Iv1.client" });
    const token = await provider(prompts, waits).token(credentialRequest(host, { interactive: true, scopes: ["repo", "read:org"] }));

    expect(token).toEqual({ ok: true, value: "gho_device" });
    expect(prompts).toEqual([
      { host: "ghe.example.test", userCode: "ABCD-1234", verificationUri: "https://ghe.example.test/login/device", expiresInSeconds: 900 },
    ]);
    expect(waits).toEqual([5000, 5000, 10000]);
    const codeRequest = new URLSearchParams(stub.requests[0]?.body);
    expect(codeRequest.get("client_id")).toBe("Iv1.client");
    expect(codeRequest.get("scope")).toBe("repo read:org");
    const poll = new URLSearchParams(stub.requests[1]?.body);
    expect(poll.get("device_code")).toBe("dev-1");
    expect(poll.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
  });

  it("stops at the code's expiry without a token", async () => {
    stub = await startStubGitHub(deviceRoutes([{ body: { error: "authorization_pending" } }]));
    const waits: number[] = [];
    const host = stubHost(stub, { oauthClientId: "Iv1.client" });
    const token = await provider([], waits).token(credentialRequest(host, { interactive: true }));
    expect(token.ok ? undefined : token.error.code).toBe("auth_required");
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(900_000);
  });

  it("reports a denied sign-in as auth_required", async () => {
    stub = await startStubGitHub(deviceRoutes([{ body: { error: "access_denied" } }]));
    const host = stubHost(stub, { oauthClientId: "Iv1.client" });
    const token = await provider([], []).token(credentialRequest(host, { interactive: true }));
    expect(token.ok ? undefined : token.error.message).toMatch(/cancelled/);
  });

  it("does not start without an interactive request or an OAuth client id", async () => {
    stub = await startStubGitHub(deviceRoutes([]));
    const prompts: DeviceCodePrompt[] = [];
    const nonInteractive = await provider(prompts, []).token(credentialRequest(stubHost(stub, { oauthClientId: "Iv1.client" })));
    const noClient = await provider(prompts, []).token(credentialRequest(stubHost(stub), { interactive: true }));
    expect(nonInteractive).toEqual({ ok: true, value: null });
    expect(noClient).toEqual({ ok: true, value: null });
    expect(prompts).toEqual([]);
    expect(stub.requests).toEqual([]);
  });
});
