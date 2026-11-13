import { err, ok, type Result } from "../result.ts";
import { authRequired, scopeMissing, type GitHubAuthError, type GitHubProviderKind } from "./errors.ts";
import type { GitHubHost } from "./hosts.ts";
import { missingScopes } from "./scopes.ts";

export type GitHubAuthResult<T> = Promise<Result<T, GitHubAuthError>>;

export interface GitHubCredentialRequest {
  readonly host: GitHubHost;
  // Scopes the caller needs, checked against the token's classic scopes when GitHub reports them.
  readonly scopes: readonly string[];
  // Only an interactive request may start the device flow, because it waits for the user.
  readonly interactive: boolean;
}

// A source of tokens. `null` means it has nothing for this host and the chain moves on.
export interface GitHubCredentialProvider {
  readonly kind: GitHubProviderKind;
  token(request: GitHubCredentialRequest): GitHubAuthResult<string | null>;
}

export interface GitHubIdentity {
  readonly login: string;
  // null when the token type has no classic scopes (fine-grained PAT, GitHub App).
  readonly scopes: readonly string[] | null;
}

export interface GitHubTokenVerifier {
  verify(host: GitHubHost, provider: GitHubProviderKind, token: string): GitHubAuthResult<GitHubIdentity>;
}

// Reads a secret from the client's broker. `null` means no value is stored under the reference.
export interface GitHubSecretReader {
  read(secretRef: string): GitHubAuthResult<string | null>;
}

export interface GitHubCredential extends GitHubIdentity {
  readonly host: string;
  readonly provider: GitHubProviderKind;
  readonly token: string;
}

export interface GitHubAuthAttempt {
  readonly provider: GitHubProviderKind;
  readonly outcome: "unavailable" | "rejected";
  readonly error?: GitHubAuthError;
}

export const gitHubProviderOrder: readonly GitHubProviderKind[] = ["gh", "device_flow", "pat"];

// Tries each provider in order and returns the first verified token with the requested scopes.
export async function resolveGitHubCredential(
  providers: readonly GitHubCredentialProvider[],
  verifier: GitHubTokenVerifier,
  request: GitHubCredentialRequest,
): GitHubAuthResult<GitHubCredential> {
  const attempts: GitHubAuthAttempt[] = [];
  for (const provider of providers) {
    const outcome = await tryProvider(provider, verifier, request);
    if (outcome.ok) {
      return outcome;
    }
    attempts.push(outcome.error);
  }
  return err(chainFailure(request.host, attempts));
}

async function tryProvider(
  provider: GitHubCredentialProvider,
  verifier: GitHubTokenVerifier,
  request: GitHubCredentialRequest,
): Promise<Result<GitHubCredential, GitHubAuthAttempt>> {
  const token = await provider.token(request);
  if (!token.ok) {
    return err({ provider: provider.kind, outcome: "rejected", error: token.error });
  }
  if (token.value === null) {
    return err({ provider: provider.kind, outcome: "unavailable" });
  }
  const identity = await verifier.verify(request.host, provider.kind, token.value);
  if (!identity.ok) {
    return err({ provider: provider.kind, outcome: "rejected", error: identity.error });
  }
  const granted = identity.value.scopes;
  const missing = granted === null ? [] : missingScopes(granted, request.scopes);
  if (granted !== null && missing[0] !== undefined) {
    return err({
      provider: provider.kind,
      outcome: "rejected",
      error: scopeMissing(request.host, missing[0], provider.kind, granted),
    });
  }
  return ok({ ...identity.value, host: request.host.host, provider: provider.kind, token: token.value });
}

// SSO and scope errors name the one action that fixes them, so they win over a generic sign-in error.
function chainFailure(host: GitHubHost, attempts: readonly GitHubAuthAttempt[]): GitHubAuthError {
  const errors = attempts.flatMap((attempt) => (attempt.error === undefined ? [] : [attempt.error]));
  const actionable = errors.find((error) => error.code === "auth_sso_required" || error.code === "auth_scope_missing");
  const chosen = actionable ?? errors[0] ?? authRequired(host, `No GitHub credentials are available for ${host.host}.`);
  return { ...chosen, details: { ...chosen.details, attempts: attempts.map(summarize) } };
}

function summarize(attempt: GitHubAuthAttempt): Record<string, string> {
  return attempt.error === undefined
    ? { provider: attempt.provider, outcome: attempt.outcome }
    : { provider: attempt.provider, outcome: attempt.outcome, code: attempt.error.code };
}
