import {
  authRequired,
  requestFailed,
  scopeMissing,
  ssoRequired,
  type GitHubAuthError,
  type GitHubProviderKind,
} from "./errors.ts";
import type { GitHubHost } from "./hosts.ts";
import { missingScopes, narrowestScope, parseScopeHeader } from "./scopes.ts";

// The parts of a non-2xx GitHub REST response that say why it failed. Header names are lower-case.
export interface GitHubFailedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly message?: string | undefined;
}

export function classifyGitHubFailure(
  host: GitHubHost,
  provider: GitHubProviderKind | null,
  response: GitHubFailedResponse,
): GitHubAuthError {
  if (response.status === 401) {
    return authRequired(host, `${host.host} rejected the GitHub token as invalid or expired.`);
  }
  const ssoUrl = ssoAuthorizationUrl(response.headers["x-github-sso"]);
  if (response.status === 403 && ssoUrl !== undefined) {
    return ssoRequired(host, ssoUrl);
  }
  const scopeError = scopeErrorFromHeaders(host, provider, response);
  if (scopeError !== undefined) {
    return scopeError;
  }
  const detail = response.message === undefined ? "" : `: ${response.message}`;
  return requestFailed(host, `${host.host} answered HTTP ${String(response.status)}${detail}`, response.status);
}

// GitHub sends `X-GitHub-SSO: required; url=<authorization url>` when SAML SSO blocks a token.
export function ssoAuthorizationUrl(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const parts = header.split(";").map((part) => part.trim());
  if (parts[0] !== "required") {
    return undefined;
  }
  const urlPart = parts.find((part) => part.startsWith("url="));
  return urlPart === undefined ? undefined : urlPart.slice("url=".length);
}

// A 403 or 404 for a token whose classic scopes cover none of the scopes the endpoint accepts.
function scopeErrorFromHeaders(
  host: GitHubHost,
  provider: GitHubProviderKind | null,
  response: GitHubFailedResponse,
): GitHubAuthError | undefined {
  if (response.status !== 403 && response.status !== 404) {
    return undefined;
  }
  const granted = parseScopeHeader(response.headers["x-oauth-scopes"]);
  const accepted = parseScopeHeader(response.headers["x-accepted-oauth-scopes"]);
  if (granted === null || accepted === null || accepted.length === 0) {
    return undefined;
  }
  if (missingScopes(granted, accepted).length < accepted.length) {
    return undefined;
  }
  const scope = narrowestScope(accepted);
  return scope === undefined ? undefined : scopeMissing(host, scope, provider, granted);
}
