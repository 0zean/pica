import {
  createMcpSecretRedactor,
  createMcpTokenManager,
  loginMcpServer,
  type McpOAuthLoginDeps,
  type McpTokenManager,
  type RuntimeSession,
} from "@pica/core";
import { FakeRuntime, parseScenario } from "@pica/testkit";
import { describe, expect, it } from "vitest";
import { createMcpOAuthCrypto, createMcpOAuthHttp, createMemoryMcpGrantStore } from "../../src/index.ts";
import { approvingBrowser, oauthStub, recordingStatus, remoteServer, type OAuthStub, type TokenReply } from "./helpers.ts";

const hour = 3_600_000;
const issued: TokenReply = {
  status: 200,
  body: { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, token_type: "Bearer" },
};

const scenario = parseScenario(
  JSON.stringify({
    version: 1,
    models: [{ id: "frontier-1", name: "Frontier 1" }],
    defaultModel: "frontier-1",
    turns: [
      { steps: [{ type: "toolCall", name: "remote-search", arguments: { q: "a" }, result: "found a" }] },
      { steps: [{ type: "text", content: "Second turn after the refresh failed." }] },
      { steps: [{ type: "toolCall", name: "remote-search", arguments: { q: "b" }, result: "found b" }] },
    ],
  }),
  "inline",
);

interface Harness {
  readonly stub: OAuthStub;
  readonly status: ReturnType<typeof recordingStatus>;
  readonly tokens: McpTokenManager;
  readonly login: () => ReturnType<typeof loginMcpServer>;
  readonly runtime: FakeRuntime;
  readonly session: RuntimeSession;
  advance(ms: number): void;
}

async function signedInSession(replies: TokenReply[]): Promise<Harness> {
  if (!scenario.ok) {
    throw new Error("scenario failed to parse");
  }
  let now = Date.parse("2026-11-13T10:00:00.000Z");
  const stub = oauthStub([issued, ...replies]);
  const status = recordingStatus();
  const redactor = createMcpSecretRedactor();
  const grants = createMemoryMcpGrantStore();
  const http = createMcpOAuthHttp({ fetch: stub.fetch, now: () => now });
  const loginDeps: McpOAuthLoginDeps = {
    http,
    grants,
    status,
    redactor,
    browser: approvingBrowser("code-1"),
    crypto: createMcpOAuthCrypto(),
    clientName: "Pica",
  };
  const login = (): ReturnType<typeof loginMcpServer> => loginMcpServer(loginDeps, remoteServer);
  expect(await login()).toEqual({ ok: true, value: undefined });
  const runtime = new FakeRuntime({ scenario: scenario.value });
  const created = await runtime.createSession({ workingDirectory: "/repo" });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  return {
    stub,
    status,
    login,
    runtime,
    session: created.value,
    tokens: createMcpTokenManager({ http, grants, status, redactor, now: () => now }),
    advance: (ms) => {
      now += ms;
    },
  };
}

async function runTurn(session: RuntimeSession, prompt: string): Promise<void> {
  const idle = new Promise<void>((resolve) => {
    const stop = session.subscribe((event) => {
      if (event.type === "session.idle") {
        stop();
        resolve();
      }
    });
  });
  const sent = await session.send(prompt);
  expect(sent.ok).toBe(true);
  await idle;
}

function sessionEnded(runtime: FakeRuntime): boolean {
  return runtime.eventLog().some((event) => event.type === "abort" || event.type === "session.error");
}

describe("token refresh failure", () => {
  it("moves the server to needs_auth and leaves the session running", async () => {
    const harness = await signedInSession([{ status: 400, body: { error: "invalid_grant" } }]);
    expect(await harness.tokens.accessToken(remoteServer)).toEqual({ ok: true, value: "access-1" });
    await runTurn(harness.session, "search a");

    harness.advance(hour);
    const result = await harness.tokens.accessToken(remoteServer);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "auth_required",
        message: "MCP server Remote needs you to sign in again: token refresh failed: the refresh_token grant was refused with 400 (invalid_grant)",
        fix: { kind: "sign_in", label: "Sign in to Remote", target: "remote" },
        details: { serverId: "remote" },
      },
    });
    expect(harness.status.changes.at(-1)).toEqual({
      serverId: "remote",
      state: "needs_auth",
      reason: "token refresh failed: the refresh_token grant was refused with 400 (invalid_grant)",
    });
    expect(harness.stub.tokenRequests.at(-1)?.get("grant_type")).toBe("refresh_token");

    await runTurn(harness.session, "keep going");
    expect(sessionEnded(harness.runtime)).toBe(false);
    expect(harness.runtime.eventLog().filter((event) => event.type === "session.idle")).toHaveLength(2);
  });

  it("forgets a rejected grant, so the server stays in needs_auth until the user signs in again", async () => {
    const harness = await signedInSession([
      { status: 401, body: { error: "invalid_client" } },
      { status: 200, body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 } },
    ]);
    harness.advance(hour);
    expect((await harness.tokens.accessToken(remoteServer)).ok).toBe(false);
    const again = await harness.tokens.accessToken(remoteServer);
    expect(again.ok).toBe(false);
    expect(harness.status.changes.at(-1)).toMatchObject({ state: "needs_auth", reason: "it has not been signed in" });

    expect(await harness.login()).toEqual({ ok: true, value: undefined });
    expect(harness.status.changes.at(-1)).toEqual({ serverId: "remote", state: "healthy", reason: null });
    expect(await harness.tokens.accessToken(remoteServer)).toEqual({ ok: true, value: "access-2" });

    await runTurn(harness.session, "search b");
    await runTurn(harness.session, "search b again");
    expect(sessionEnded(harness.runtime)).toBe(false);
  });

  it("from an unreachable authorization server also reports needs_auth but keeps the grant to retry", async () => {
    const harness = await signedInSession([
      { status: 503, body: {} },
      { status: 200, body: { access_token: "access-2", expires_in: 3600 } },
    ]);
    harness.advance(hour);
    const failed = await harness.tokens.accessToken(remoteServer);
    expect(failed.ok).toBe(false);
    expect(harness.status.changes.at(-1)).toMatchObject({ state: "needs_auth" });

    expect(await harness.tokens.accessToken(remoteServer)).toEqual({ ok: true, value: "access-2" });
    expect(harness.stub.tokenRequests.at(-1)?.get("refresh_token")).toBe("refresh-1");
    await runTurn(harness.session, "search a");
    expect(sessionEnded(harness.runtime)).toBe(false);
  });

  it("is attempted once for concurrent callers", async () => {
    const harness = await signedInSession([{ status: 400, body: { error: "invalid_grant" } }]);
    harness.advance(hour);
    const results = await Promise.all([
      harness.tokens.accessToken(remoteServer),
      harness.tokens.accessToken(remoteServer),
    ]);
    expect(results.map((result) => result.ok)).toEqual([false, false]);
    expect(harness.stub.tokenRequests.filter((body) => body.get("grant_type") === "refresh_token")).toHaveLength(1);
  });

  it("after a 401 from the MCP server is forced even before the stated expiry", async () => {
    const harness = await signedInSession([{ status: 400, body: { error: "invalid_grant" } }]);
    const result = await harness.tokens.accessToken(remoteServer, { forceRefresh: true });
    expect(result.ok).toBe(false);
    expect(harness.status.changes.at(-1)).toMatchObject({ state: "needs_auth" });
  });
});

describe("mcp.login", () => {
  it("sends PKCE, state, and the resource indicator, and exchanges the code", async () => {
    const harness = await signedInSession([]);
    const exchange = harness.stub.tokenRequests[0];
    expect(exchange?.get("grant_type")).toBe("authorization_code");
    expect(exchange?.get("code")).toBe("code-1");
    expect(exchange?.get("client_id")).toBe("client-1");
    expect(exchange?.get("resource")).toBe("https://mcp.example.com/mcp");
    expect(exchange?.get("redirect_uri")).toBe("http://127.0.0.1:7777/callback");
    expect(exchange?.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
  });
});
