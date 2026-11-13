import type { McpServerDef } from "@pica/protocol";
import { err, ok, type Result } from "../result.ts";
import { mcpAuthRequired, type McpAuthError } from "./errors.ts";
import { rememberTokens } from "./login.ts";
import type {
  McpAuthStatusSink,
  McpOAuthFailure,
  McpOAuthGrant,
  McpOAuthGrantStore,
  McpOAuthHttp,
} from "./oauth-port.ts";
import type { McpSecretRedactor } from "./redact.ts";

export interface McpTokenManagerDeps {
  readonly http: McpOAuthHttp;
  readonly grants: McpOAuthGrantStore;
  readonly status: McpAuthStatusSink;
  readonly redactor: McpSecretRedactor;
  // Epoch milliseconds.
  readonly now: () => number;
}

export interface McpAccessTokenRequest {
  // Set after the MCP server answered 401 to the current token.
  readonly forceRefresh?: boolean;
}

// Hands out a current access token per server, refreshing it when it is about to expire. A failed
// refresh reports the server as `needs_auth` and returns `auth_required`; it never touches sessions,
// so a session using the server keeps running and can use it again after `mcp.login`.
export interface McpTokenManager {
  accessToken(definition: McpServerDef, request?: McpAccessTokenRequest): Promise<Result<string, McpAuthError>>;
}

// Refresh this long before the token's stated expiry, so it does not expire in flight.
export const mcpTokenRefreshSkewMs = 60_000;

export function createMcpTokenManager(deps: McpTokenManagerDeps): McpTokenManager {
  const inFlight = new Map<string, Promise<Result<string, McpAuthError>>>();
  return {
    accessToken(definition, request = {}) {
      const running = inFlight.get(definition.id);
      if (running !== undefined) {
        return running;
      }
      const next = currentToken(deps, definition, request.forceRefresh === true).finally(() => {
        inFlight.delete(definition.id);
      });
      inFlight.set(definition.id, next);
      return next;
    },
  };
}

async function currentToken(
  deps: McpTokenManagerDeps,
  definition: McpServerDef,
  forceRefresh: boolean,
): Promise<Result<string, McpAuthError>> {
  const loaded = await deps.grants.load(definition.id);
  if (!loaded.ok) {
    return err(needsAuth(deps, definition, loaded.error.message));
  }
  const grant = loaded.value;
  if (grant === null) {
    return err(needsAuth(deps, definition, "it has not been signed in"));
  }
  rememberTokens(deps.redactor, grant.tokens);
  if (!forceRefresh && !expiring(grant, deps.now())) {
    return ok(grant.tokens.accessToken);
  }
  return refresh(deps, definition, grant);
}

function expiring(grant: McpOAuthGrant, now: number): boolean {
  return grant.tokens.expiresAt !== null && grant.tokens.expiresAt - mcpTokenRefreshSkewMs <= now;
}

async function refresh(
  deps: McpTokenManagerDeps,
  definition: McpServerDef,
  grant: McpOAuthGrant,
): Promise<Result<string, McpAuthError>> {
  const refreshToken = grant.tokens.refreshToken;
  if (refreshToken === null) {
    return err(await refreshFailed(deps, definition, { kind: "rejected", message: "the access token expired and cannot be refreshed" }));
  }
  const refreshed = await deps.http.refresh({
    metadata: grant.metadata,
    client: grant.client,
    resource: grant.resource,
    refreshToken,
  });
  if (!refreshed.ok) {
    return err(await refreshFailed(deps, definition, refreshed.error));
  }
  // RFC 6749 §6: the server may keep the old refresh token instead of issuing a new one.
  const tokens = { ...refreshed.value, refreshToken: refreshed.value.refreshToken ?? refreshToken };
  rememberTokens(deps.redactor, tokens);
  const saved = await deps.grants.save({ ...grant, tokens });
  if (!saved.ok) {
    return err(await refreshFailed(deps, definition, saved.error));
  }
  return ok(tokens.accessToken);
}

async function refreshFailed(
  deps: McpTokenManagerDeps,
  definition: McpServerDef,
  cause: McpOAuthFailure,
): Promise<McpAuthError> {
  if (cause.kind === "rejected") {
    // A failed clear leaves a grant that the next refresh rejects again, which reports the same state.
    await deps.grants.clear(definition.id);
  }
  return needsAuth(deps, definition, `token refresh failed: ${cause.message}`);
}

function needsAuth(deps: McpTokenManagerDeps, definition: McpServerDef, reason: string): McpAuthError {
  const redacted = deps.redactor.redact(reason);
  deps.status.needsAuth(definition.id, redacted);
  return mcpAuthRequired(definition.id, definition.name, redacted);
}

// Adds the bearer token to an http or sse launch.
export function withMcpBearerToken<T extends { readonly headers: Readonly<Record<string, string>> }>(
  transport: T,
  accessToken: string,
): T {
  return { ...transport, headers: { ...transport.headers, Authorization: `Bearer ${accessToken}` } };
}
