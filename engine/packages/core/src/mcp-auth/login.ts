import type { McpServerDef } from "@pica/protocol";
import { err, ok, type Result } from "../result.ts";
import { mcpAuthRequired, mcpOAuthUnsupported, type McpAuthError } from "./errors.ts";
import type {
  McpAuthStatusSink,
  McpOAuthBrowser,
  McpOAuthClient,
  McpOAuthCrypto,
  McpOAuthFailure,
  McpOAuthGrantStore,
  McpOAuthHttp,
  McpOAuthRedirect,
  McpOAuthServerMetadata,
} from "./oauth-port.ts";
import type { McpSecretRedactor } from "./redact.ts";

export interface McpOAuthLoginDeps {
  readonly http: McpOAuthHttp;
  readonly browser: McpOAuthBrowser;
  readonly crypto: McpOAuthCrypto;
  readonly grants: McpOAuthGrantStore;
  readonly status: McpAuthStatusSink;
  readonly redactor: McpSecretRedactor;
  readonly clientName: string;
}

// `mcp.login`: authorization code flow with PKCE against the server's authorization server.
export async function loginMcpServer(
  deps: McpOAuthLoginDeps,
  definition: McpServerDef,
): Promise<Result<undefined, McpAuthError>> {
  if (definition.transport.type === "stdio") {
    return err(mcpOAuthUnsupported(definition.id, "OAuth applies to http and sse servers only"));
  }
  const resource = definition.transport.url;
  const metadata = await deps.http.discover(resource);
  if (!metadata.ok) {
    return err(failure(deps, definition, metadata.error));
  }
  const redirect = await deps.browser.listen();
  if (!redirect.ok) {
    return err(failure(deps, definition, redirect.error));
  }
  try {
    return await authorize(deps, definition, resource, metadata.value, redirect.value);
  } finally {
    redirect.value.close();
  }
}

async function authorize(
  deps: McpOAuthLoginDeps,
  definition: McpServerDef,
  resource: string,
  metadata: McpOAuthServerMetadata,
  redirect: McpOAuthRedirect,
): Promise<Result<undefined, McpAuthError>> {
  const client = await registeredClient(deps, definition, metadata, redirect.redirectUri);
  if (!client.ok) {
    return client;
  }
  const verifier = deps.crypto.randomToken();
  const state = deps.crypto.randomToken();
  deps.redactor.remember(verifier);
  deps.browser.open(
    authorizationUrl(metadata, client.value, {
      redirectUri: redirect.redirectUri,
      resource,
      state,
      codeChallenge: deps.crypto.codeChallenge(verifier),
    }),
  );
  const callback = await redirect.wait();
  if (!callback.ok) {
    return err(failure(deps, definition, callback.error));
  }
  if (callback.value.state !== state) {
    return err(failure(deps, definition, { kind: "rejected", message: "the redirect carried the wrong state" }));
  }
  deps.redactor.remember(callback.value.code);
  const tokens = await deps.http.exchangeCode({
    metadata,
    client: client.value,
    resource,
    redirectUri: redirect.redirectUri,
    code: callback.value.code,
    codeVerifier: verifier,
  });
  if (!tokens.ok) {
    return err(failure(deps, definition, tokens.error));
  }
  rememberTokens(deps.redactor, tokens.value);
  const saved = await deps.grants.save({
    serverId: definition.id,
    resource,
    metadata,
    client: client.value,
    redirectUri: redirect.redirectUri,
    tokens: tokens.value,
  });
  if (!saved.ok) {
    return err(failure(deps, definition, saved.error));
  }
  deps.status.authorized(definition.id);
  return ok(undefined);
}

async function registeredClient(
  deps: McpOAuthLoginDeps,
  definition: McpServerDef,
  metadata: McpOAuthServerMetadata,
  redirectUri: string,
): Promise<Result<McpOAuthClient, McpAuthError>> {
  if (metadata.registrationEndpoint === null) {
    return err(mcpOAuthUnsupported(definition.id, `${metadata.issuer} does not offer dynamic client registration`));
  }
  const client = await deps.http.register(metadata, redirectUri, deps.clientName);
  return client.ok ? client : err(failure(deps, definition, client.error));
}

interface AuthorizationParams {
  readonly redirectUri: string;
  readonly resource: string;
  readonly state: string;
  readonly codeChallenge: string;
}

export function authorizationUrl(
  metadata: McpOAuthServerMetadata,
  client: McpOAuthClient,
  params: AuthorizationParams,
): string {
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("resource", params.resource);
  if (metadata.scopesSupported.length > 0) {
    url.searchParams.set("scope", metadata.scopesSupported.join(" "));
  }
  return url.toString();
}

export function rememberTokens(
  redactor: McpSecretRedactor,
  tokens: { readonly accessToken: string; readonly refreshToken: string | null },
): void {
  redactor.remember(tokens.accessToken);
  if (tokens.refreshToken !== null) {
    redactor.remember(tokens.refreshToken);
  }
}

function failure(deps: McpOAuthLoginDeps, definition: McpServerDef, cause: McpOAuthFailure): McpAuthError {
  const reason = deps.redactor.redact(cause.message);
  return cause.kind === "unsupported" ? mcpOAuthUnsupported(definition.id, reason) : mcpAuthRequired(definition.id, definition.name, reason);
}
