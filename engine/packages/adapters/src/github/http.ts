import {
  classifyGitHubFailure,
  err,
  gitHubRequestFailed,
  ok,
  parseGitHubScopeHeader,
  type GitHubAuthResult,
  type GitHubHost,
  type GitHubIdentity,
  type GitHubProviderKind,
  type GitHubTokenVerifier,
} from "@pica/core";

export type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GitHubHttpOptions {
  readonly fetch?: GitHubFetch;
}

export interface GitHubJsonResponse {
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

const apiVersion = "2022-11-28";

// GET a REST path with the token; any non-2xx answer becomes a typed auth or request error.
export async function gitHubGetJson(
  host: GitHubHost,
  provider: GitHubProviderKind | null,
  token: string,
  path: string,
  options: GitHubHttpOptions = {},
): GitHubAuthResult<GitHubJsonResponse> {
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${host.apiBaseUrl}${path}`, {
      headers: gitHubRequestHeaders(token),
    });
  } catch (error) {
    return err(gitHubRequestFailed(host, `could not reach ${host.apiBaseUrl}: ${errorMessage(error)}`));
  }
  const headers = Object.fromEntries(response.headers.entries());
  const body = await readJson(response);
  if (!response.ok) {
    return err(classifyGitHubFailure(host, provider, { status: response.status, headers, message: bodyMessage(body) }));
  }
  return ok({ body, headers });
}

export function gitHubRequestHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "pica",
    "x-github-api-version": apiVersion,
  };
}

export function createGitHubTokenVerifier(options: GitHubHttpOptions = {}): GitHubTokenVerifier {
  return {
    async verify(host, provider, token): GitHubAuthResult<GitHubIdentity> {
      const response = await gitHubGetJson(host, provider, token, "/user", options);
      if (!response.ok) {
        return response;
      }
      const login = loginOf(response.value.body);
      if (login === undefined) {
        return err(gitHubRequestFailed(host, `${host.host} answered /user without a login`));
      }
      return ok({ login, scopes: parseGitHubScopeHeader(response.value.headers["x-oauth-scopes"]) });
    },
  };
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loginOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("login" in body)) {
    return undefined;
  }
  return typeof body.login === "string" ? body.login : undefined;
}

export function bodyMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("message" in body)) {
    return undefined;
  }
  return typeof body.message === "string" ? body.message : undefined;
}
