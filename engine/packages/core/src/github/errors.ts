import type { ProtocolErrorCode } from "../runtime/errors.ts";
import type { GitHubHost } from "./hosts.ts";

export type GitHubProviderKind = "gh" | "device_flow" | "pat";

export type GitHubAuthErrorCode = Extract<
  ProtocolErrorCode,
  "auth_required" | "auth_sso_required" | "auth_scope_missing" | "secret_unresolved" | "github_request_failed"
>;

// Mirrors `FixAction` in @pica/protocol so the error can be sent to the client as `data.fix`.
export interface GitHubFix {
  readonly kind: "open_url" | "open_settings" | "retry" | "sign_in" | "run_command";
  readonly label: string;
  readonly target?: string;
}

export interface GitHubAuthError {
  readonly code: GitHubAuthErrorCode;
  readonly message: string;
  readonly fix?: GitHubFix;
  readonly details?: Readonly<Record<string, unknown>>;
}

// The `ErrorData` payload (PLAN.md §4.5) for an error that reaches the client.
export function gitHubAuthErrorData(error: GitHubAuthError): {
  code: GitHubAuthErrorCode;
  fix?: GitHubFix;
  details?: Record<string, unknown>;
} {
  return {
    code: error.code,
    ...(error.fix === undefined ? {} : { fix: error.fix }),
    ...(error.details === undefined ? {} : { details: { ...error.details } }),
  };
}

export function ssoRequired(host: GitHubHost, authorizationUrl: string): GitHubAuthError {
  return {
    code: "auth_sso_required",
    message: `An organization on ${host.host} uses SAML single sign-on; authorize the token for it to continue.`,
    fix: { kind: "open_url", label: "Authorize for single sign-on", target: authorizationUrl },
    details: { host: host.host },
  };
}

export function scopeMissing(
  host: GitHubHost,
  scope: string,
  provider: GitHubProviderKind | null,
  granted: readonly string[],
): GitHubAuthError {
  return {
    code: "auth_scope_missing",
    message: `The GitHub token for ${host.host} is missing the ${scope} scope.`,
    fix: scopeFix(host, scope, provider),
    details: { host: host.host, scope, grantedScopes: [...granted] },
  };
}

function scopeFix(host: GitHubHost, scope: string, provider: GitHubProviderKind | null): GitHubFix {
  if (provider === "gh") {
    return { kind: "run_command", label: `Grant ${scope} to the gh CLI`, target: `gh auth refresh --hostname ${host.host} --scopes ${scope}` };
  }
  if (provider === "pat") {
    return { kind: "open_url", label: `Add ${scope} to the token`, target: `${host.webBaseUrl}/settings/tokens` };
  }
  return { kind: "sign_in", label: `Sign in to ${host.host} again`, target: host.host };
}

export function authRequired(host: GitHubHost, message: string): GitHubAuthError {
  return {
    code: "auth_required",
    message,
    fix: { kind: "sign_in", label: `Sign in to ${host.host}`, target: host.host },
    details: { host: host.host },
  };
}

export function requestFailed(host: GitHubHost, message: string, status?: number): GitHubAuthError {
  return {
    code: "github_request_failed",
    message,
    fix: { kind: "retry", label: "Try again" },
    details: { host: host.host, ...(status === undefined ? {} : { status }) },
  };
}
