import type { Result } from "../result.ts";

export interface McpOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  // Epoch milliseconds; `null` when the authorization server gave no lifetime.
  readonly expiresAt: number | null;
  readonly scope: string | null;
}

// RFC 8414 metadata of the authorization server that protects an MCP server (found through RFC 9728).
export interface McpOAuthServerMetadata {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string | null;
  readonly scopesSupported: readonly string[];
}

// A public client (PKCE, no client secret) registered with RFC 7591 dynamic client registration.
export interface McpOAuthClient {
  readonly clientId: string;
}

// What the engine keeps for a signed-in server.
export interface McpOAuthGrant {
  readonly serverId: string;
  // The MCP server URL, sent as the RFC 8707 `resource` parameter.
  readonly resource: string;
  readonly metadata: McpOAuthServerMetadata;
  readonly client: McpOAuthClient;
  readonly redirectUri: string;
  readonly tokens: McpOAuthTokens;
}

export type McpOAuthFailureKind =
  // The authorization server answered and refused (`invalid_grant`, `invalid_client`, 400, 401).
  | "rejected"
  // It could not be reached or answered with a server error.
  | "unavailable"
  | "invalid_response"
  | "unsupported"
  | "cancelled";

export interface McpOAuthFailure {
  readonly kind: McpOAuthFailureKind;
  // Never contains a token, code, or verifier.
  readonly message: string;
}

export type McpOAuthResult<T> = Promise<Result<T, McpOAuthFailure>>;

export interface McpOAuthCodeExchange {
  readonly metadata: McpOAuthServerMetadata;
  readonly client: McpOAuthClient;
  readonly resource: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly codeVerifier: string;
}

export interface McpOAuthRefresh {
  readonly metadata: McpOAuthServerMetadata;
  readonly client: McpOAuthClient;
  readonly resource: string;
  readonly refreshToken: string;
}

export interface McpOAuthHttp {
  discover(serverUrl: string): McpOAuthResult<McpOAuthServerMetadata>;
  register(metadata: McpOAuthServerMetadata, redirectUri: string, clientName: string): McpOAuthResult<McpOAuthClient>;
  exchangeCode(request: McpOAuthCodeExchange): McpOAuthResult<McpOAuthTokens>;
  refresh(request: McpOAuthRefresh): McpOAuthResult<McpOAuthTokens>;
}

export interface McpOAuthRedirect {
  readonly redirectUri: string;
  // Resolves with the query of the first request to the redirect URI.
  wait(): McpOAuthResult<{ readonly code: string; readonly state: string }>;
  close(): void;
}

export interface McpOAuthBrowser {
  // Starts listening for the authorization server's redirect on a loopback address.
  listen(): McpOAuthResult<McpOAuthRedirect>;
  // Asks the client to open the authorization page.
  open(url: string): void;
}

export interface McpOAuthCrypto {
  // A high-entropy URL-safe string for the PKCE verifier and `state`.
  randomToken(): string;
  // The RFC 7636 S256 code challenge for `verifier`.
  codeChallenge(verifier: string): string;
}

export interface McpOAuthGrantStore {
  load(serverId: string): McpOAuthResult<McpOAuthGrant | null>;
  save(grant: McpOAuthGrant): McpOAuthResult<undefined>;
  clear(serverId: string): McpOAuthResult<undefined>;
}

// Where `needs_auth` and its recovery are reported (`mcp.statusChanged`, M-06's health view).
export interface McpAuthStatusSink {
  needsAuth(serverId: string, reason: string): void;
  authorized(serverId: string): void;
}
