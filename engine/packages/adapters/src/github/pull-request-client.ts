import {
  classifyGitHubFailure,
  err,
  gitHubRequestFailed,
  ok,
  type GitHubAuthResult,
  type GitHubHost,
  type GitHubProviderKind,
  type GitHubRepoRef,
  type PullRequestClient,
  type PullRequestRef,
} from "@pica/core";
import { bodyMessage, errorMessage, gitHubRequestHeaders, readJson, type GitHubHttpOptions } from "./http.ts";

export interface GitHubPullRequestClientOptions extends GitHubHttpOptions {
  readonly host: GitHubHost;
  // The provider the token came from, so scope errors name the right fix.
  readonly provider: GitHubProviderKind | null;
  readonly token: string;
}

// The pull request port over the REST API: `POST /repos/{owner}/{repo}/pulls` and `PATCH .../pulls/{number}`.
export function createGitHubPullRequestClient(options: GitHubPullRequestClientOptions): PullRequestClient {
  const send = (method: string, path: string, payload: Record<string, unknown>): GitHubAuthResult<unknown> =>
    sendJson(options, method, path, payload);
  return {
    async create(request): GitHubAuthResult<PullRequestRef> {
      const sent = await send("POST", `${repoPath(request.repo)}/pulls`, {
        title: request.title,
        head: request.head,
        base: request.base,
        body: request.body,
        ...(request.draft === undefined ? {} : { draft: request.draft }),
      });
      if (!sent.ok) {
        return sent;
      }
      const created = pullRequestOf(request.repo, sent.value);
      return created === undefined
        ? err(gitHubRequestFailed(options.host, `${options.host.host} answered without a pull request number and URL`))
        : ok(created);
    },
    async updateBody(pullRequest, body): GitHubAuthResult<undefined> {
      const sent = await send("PATCH", `${repoPath(pullRequest.repo)}/pulls/${String(pullRequest.number)}`, { body });
      return sent.ok ? ok(undefined) : sent;
    },
  };
}

async function sendJson(
  options: GitHubPullRequestClientOptions,
  method: string,
  path: string,
  payload: Record<string, unknown>,
): GitHubAuthResult<unknown> {
  const { host, provider, token } = options;
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${host.apiBaseUrl}${path}`, {
      method,
      headers: { ...gitHubRequestHeaders(token), "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return err(gitHubRequestFailed(host, `could not reach ${host.apiBaseUrl}: ${errorMessage(error)}`));
  }
  const headers = Object.fromEntries(response.headers.entries());
  const body = await readJson(response);
  if (!response.ok) {
    return err(classifyGitHubFailure(host, provider, { status: response.status, headers, message: bodyMessage(body) }));
  }
  return ok(body);
}

function repoPath(repo: GitHubRepoRef): string {
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

function pullRequestOf(repo: GitHubRepoRef, body: unknown): PullRequestRef | undefined {
  if (typeof body !== "object" || body === null || !("number" in body) || !("html_url" in body)) {
    return undefined;
  }
  const { number, html_url: url } = body;
  return typeof number === "number" && typeof url === "string" ? { repo, number, url } : undefined;
}
