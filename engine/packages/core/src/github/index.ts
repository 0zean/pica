export { classifyGitHubFailure, ssoAuthorizationUrl, type GitHubFailedResponse } from "./classify.ts";
export {
  gitHubProviderOrder,
  resolveGitHubCredential,
  type GitHubAuthAttempt,
  type GitHubAuthResult,
  type GitHubCredential,
  type GitHubCredentialProvider,
  type GitHubCredentialRequest,
  type GitHubIdentity,
  type GitHubSecretReader,
  type GitHubTokenVerifier,
} from "./credentials.ts";
export {
  authRequired as gitHubAuthRequired,
  gitHubAuthErrorData,
  requestFailed as gitHubRequestFailed,
  type GitHubAuthError,
  type GitHubAuthErrorCode,
  type GitHubFix,
  type GitHubProviderKind,
} from "./errors.ts";
export { githubDotCom, resolveGitHubHost, type GitHubHost, type GitHubHostSettings } from "./hosts.ts";
export { hasScope as gitHubHasScope, missingScopes as gitHubMissingScopes, parseScopeHeader as parseGitHubScopeHeader } from "./scopes.ts";
