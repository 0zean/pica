import {
  err,
  ok,
  type McpOAuthClient,
  type McpOAuthFailure,
  type McpOAuthHttp,
  type McpOAuthResult,
  type McpOAuthServerMetadata,
  type McpOAuthTokens,
  type Result,
} from "@pica/core";
import { errorMessage, isRecord, readJson, stringArrayField, stringField, type JsonRecord } from "./json.ts";

export type McpOAuthFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface McpOAuthHttpOptions {
  readonly fetch?: McpOAuthFetch;
  // Epoch milliseconds, for turning `expires_in` into an expiry time.
  readonly now?: () => number;
}

// RFC 9728 protected resource metadata, RFC 8414 authorization server metadata, RFC 7591 registration,
// and the RFC 6749 token endpoint. Failure messages carry status codes and OAuth error codes only,
// never a response body, so a server echoing a token cannot leak it.
export function createMcpOAuthHttp(options: McpOAuthHttpOptions = {}): McpOAuthHttp {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  return {
    discover: (serverUrl) => discover(doFetch, serverUrl),
    register: (metadata, redirectUri, clientName) => register(doFetch, metadata, redirectUri, clientName),
    exchangeCode: (request) =>
      tokenRequest(doFetch, now, request.metadata, {
        grant_type: "authorization_code",
        code: request.code,
        code_verifier: request.codeVerifier,
        redirect_uri: request.redirectUri,
        client_id: request.client.clientId,
        resource: request.resource,
      }),
    refresh: (request) =>
      tokenRequest(doFetch, now, request.metadata, {
        grant_type: "refresh_token",
        refresh_token: request.refreshToken,
        client_id: request.client.clientId,
        resource: request.resource,
      }),
  };
}

type Fetched = { readonly status: number; readonly body: unknown };

interface Outgoing {
  readonly method: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

async function send(doFetch: McpOAuthFetch, url: string, outgoing: Outgoing): McpOAuthResult<Fetched> {
  try {
    const response = await doFetch(url, {
      method: outgoing.method,
      headers: { accept: "application/json", ...outgoing.headers },
      ...(outgoing.body === undefined ? {} : { body: outgoing.body }),
    });
    return ok({ status: response.status, body: await readJson(response) });
  } catch (error) {
    return err({ kind: "unavailable", message: `could not reach ${new URL(url).origin}: ${errorMessage(error)}` });
  }
}

// RFC 9728 §3.1 and RFC 8414 §3.1: the well-known segment goes between the origin and the path.
function wellKnown(base: string, suffix: string): readonly string[] {
  const url = new URL(base);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  const candidates = [`${url.origin}/.well-known/${suffix}${path}`];
  if (path !== "") {
    candidates.push(`${url.origin}/.well-known/${suffix}`);
  }
  return candidates;
}

async function firstJson(doFetch: McpOAuthFetch, urls: readonly string[]): McpOAuthResult<JsonRecord | null> {
  for (const url of urls) {
    const fetched = await send(doFetch, url, { method: "GET" });
    if (!fetched.ok) {
      return fetched;
    }
    if (fetched.value.status >= 500) {
      return err({ kind: "unavailable", message: `${url} answered ${String(fetched.value.status)}` });
    }
    if (fetched.value.status === 200 && isRecord(fetched.value.body)) {
      return ok(fetched.value.body);
    }
  }
  return ok(null);
}

async function discover(doFetch: McpOAuthFetch, serverUrl: string): McpOAuthResult<McpOAuthServerMetadata> {
  const resource = await firstJson(doFetch, wellKnown(serverUrl, "oauth-protected-resource"));
  if (!resource.ok) {
    return resource;
  }
  // Servers without RFC 9728 metadata are their own authorization server (MCP 2025-03-26 fallback).
  const issuer =
    (resource.value === null ? null : stringArrayField(resource.value, "authorization_servers")[0]) ??
    new URL(serverUrl).origin;
  const metadata = await firstJson(doFetch, [
    ...wellKnown(issuer, "oauth-authorization-server"),
    ...wellKnown(issuer, "openid-configuration"),
  ]);
  if (!metadata.ok) {
    return metadata;
  }
  if (metadata.value === null) {
    return err({ kind: "unsupported", message: `${issuer} publishes no authorization server metadata` });
  }
  const authorizationEndpoint = stringField(metadata.value, "authorization_endpoint");
  const tokenEndpoint = stringField(metadata.value, "token_endpoint");
  if (authorizationEndpoint === null || tokenEndpoint === null) {
    return err({ kind: "invalid_response", message: `${issuer} metadata lacks the authorization or token endpoint` });
  }
  return ok({
    issuer: stringField(metadata.value, "issuer") ?? issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: stringField(metadata.value, "registration_endpoint"),
    scopesSupported: resource.value === null ? [] : stringArrayField(resource.value, "scopes_supported"),
  });
}

async function register(
  doFetch: McpOAuthFetch,
  metadata: McpOAuthServerMetadata,
  redirectUri: string,
  clientName: string,
): McpOAuthResult<McpOAuthClient> {
  const endpoint = metadata.registrationEndpoint ?? "";
  const fetched = await send(doFetch, endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!fetched.ok) {
    return fetched;
  }
  if (fetched.value.status !== 201 && fetched.value.status !== 200) {
    return err(httpFailure("client registration", fetched.value));
  }
  const clientId = isRecord(fetched.value.body) ? stringField(fetched.value.body, "client_id") : null;
  return clientId === null
    ? err({ kind: "invalid_response", message: "client registration returned no client_id" })
    : ok({ clientId });
}

async function tokenRequest(
  doFetch: McpOAuthFetch,
  now: () => number,
  metadata: McpOAuthServerMetadata,
  form: Readonly<Record<string, string>>,
): McpOAuthResult<McpOAuthTokens> {
  const fetched = await send(doFetch, metadata.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!fetched.ok) {
    return fetched;
  }
  if (fetched.value.status !== 200) {
    return err(httpFailure(`the ${form["grant_type"] ?? "token"} grant`, fetched.value));
  }
  return parseTokens(fetched.value.body, now());
}

function parseTokens(body: unknown, now: number): Result<McpOAuthTokens, McpOAuthFailure> {
  const accessToken = isRecord(body) ? stringField(body, "access_token") : null;
  if (!isRecord(body) || accessToken === null) {
    return err({ kind: "invalid_response", message: "the token endpoint returned no access_token" });
  }
  const expiresIn = body["expires_in"];
  return ok({
    accessToken,
    refreshToken: stringField(body, "refresh_token"),
    expiresAt: typeof expiresIn === "number" && expiresIn > 0 ? now + expiresIn * 1000 : null,
    scope: stringField(body, "scope"),
  });
}

const oauthErrorPattern = /^[a-z_]{1,40}$/;

function httpFailure(what: string, fetched: Fetched): McpOAuthFailure {
  const code = isRecord(fetched.body) ? stringField(fetched.body, "error") : null;
  // Only the registered shape of RFC 6749 §5.2 codes is repeated, never free text.
  const reason = code !== null && oauthErrorPattern.test(code) ? ` (${code})` : "";
  const status = String(fetched.status);
  if (fetched.status >= 500) {
    return { kind: "unavailable", message: `${what} failed with ${status}${reason}` };
  }
  return { kind: "rejected", message: `${what} was refused with ${status}${reason}` };
}
