import { ok, type McpAuthStatusSink, type McpOAuthBrowser } from "@pica/core";
import type { McpServerDef } from "@pica/protocol";
import type { McpOAuthFetch } from "../../src/index.ts";

export const remoteServer: McpServerDef = {
  id: "remote",
  name: "Remote",
  transport: { type: "http", url: "https://mcp.example.com/mcp", headers: {} },
  toolAllowlist: null,
  scope: "global",
};

export interface TokenReply {
  readonly status: number;
  readonly body: unknown;
}

export interface OAuthStub {
  readonly fetch: McpOAuthFetch;
  // Bodies of the requests sent to the token endpoint, in order.
  readonly tokenRequests: URLSearchParams[];
  // Answers for the token endpoint, consumed in order.
  readonly tokenReplies: TokenReply[];
}

const authorizationServer = "https://auth.example.com";

// A protected MCP server and its authorization server, served from memory.
export function oauthStub(tokenReplies: TokenReply[]): OAuthStub {
  const tokenRequests: URLSearchParams[] = [];
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const routes: Readonly<Record<string, (init: RequestInit) => Response>> = {
    "GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp": () =>
      json(200, { resource: "https://mcp.example.com/mcp", authorization_servers: [authorizationServer], scopes_supported: ["tools"] }),
    [`GET ${authorizationServer}/.well-known/oauth-authorization-server`]: () =>
      json(200, {
        issuer: authorizationServer,
        authorization_endpoint: `${authorizationServer}/authorize`,
        token_endpoint: `${authorizationServer}/token`,
        registration_endpoint: `${authorizationServer}/register`,
      }),
    [`POST ${authorizationServer}/register`]: () => json(201, { client_id: "client-1" }),
    [`POST ${authorizationServer}/token`]: (init) => {
      tokenRequests.push(new URLSearchParams(typeof init.body === "string" ? init.body : ""));
      const reply = tokenReplies.shift();
      return reply === undefined ? json(500, { error: "server_error" }) : json(reply.status, reply.body);
    },
  };
  return {
    tokenRequests,
    tokenReplies,
    fetch: (url, init) => {
      const route = routes[`${init.method ?? "GET"} ${url}`];
      return Promise.resolve(route === undefined ? json(404, {}) : route(init));
    },
  };
}

// Plays the user: approves the authorization page at once and redirects with `code`.
export function approvingBrowser(code: string): McpOAuthBrowser & { readonly opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    open: (url) => {
      opened.push(url);
    },
    listen: () =>
      Promise.resolve(
        ok({
          redirectUri: "http://127.0.0.1:7777/callback",
          wait: () => {
            const state = new URL(opened.at(-1) ?? "http://x").searchParams.get("state") ?? "";
            return Promise.resolve(ok({ code, state }));
          },
          close: () => undefined,
        }),
      ),
  };
}

export interface StatusChange {
  readonly serverId: string;
  readonly state: "needs_auth" | "healthy";
  readonly reason: string | null;
}

export function recordingStatus(): McpAuthStatusSink & { readonly changes: StatusChange[] } {
  const changes: StatusChange[] = [];
  return {
    changes,
    needsAuth: (serverId, reason) => {
      changes.push({ serverId, state: "needs_auth", reason });
    },
    authorized: (serverId) => {
      changes.push({ serverId, state: "healthy", reason: null });
    },
  };
}
