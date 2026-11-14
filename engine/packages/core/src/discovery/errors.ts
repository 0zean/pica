import type { GitHubAuthError } from "../github/errors.ts";

// GitHub failures keep their auth error (with its `fix`); a source that cannot be discovered is `invalid_params`.
export type DiscoveryError =
  | GitHubAuthError
  | { readonly code: "invalid_params"; readonly message: string; readonly details?: Readonly<Record<string, unknown>> };

export function invalidSelector(message: string, details: Readonly<Record<string, unknown>>): DiscoveryError {
  return { code: "invalid_params", message, details };
}
