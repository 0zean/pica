import {
  classifyGitHubFailure,
  err,
  gitHubRequestFailed,
  ok,
  type GitHubAuthResult,
  type GitHubHost,
  type GitHubPage,
  type GitHubProviderKind,
  type GitHubRestClient,
} from "@pica/core";
import { bodyMessage, errorMessage, gitHubRequestHeaders, readJson, type GitHubHttpOptions } from "./http.ts";

export interface GitHubRestClientOptions extends GitHubHttpOptions {
  readonly host: GitHubHost;
  // The provider the token came from, so scope errors name the right fix.
  readonly provider: GitHubProviderKind | null;
  readonly token: string;
}

// The discovery port over fetch: conditional GETs with `If-None-Match`, and pagination URLs taken as given.
export function createGitHubRestClient(options: GitHubRestClientOptions): GitHubRestClient {
  const { host, provider, token } = options;
  const doFetch = options.fetch ?? fetch;
  return {
    host,
    async get(target, etag): GitHubAuthResult<GitHubPage> {
      const url = target.startsWith("/") ? `${host.apiBaseUrl}${target}` : target;
      if (!url.startsWith(`${host.apiBaseUrl}/`)) {
        return err(gitHubRequestFailed(host, `refusing to send the ${host.host} token to ${url}`));
      }
      let response: Response;
      try {
        response = await doFetch(url, {
          headers: { ...gitHubRequestHeaders(token), ...(etag === null ? {} : { "if-none-match": etag }) },
        });
      } catch (error) {
        return err(gitHubRequestFailed(host, `could not reach ${host.apiBaseUrl}: ${errorMessage(error)}`));
      }
      if (response.status === 304) {
        await response.body?.cancel();
        return ok({ status: "not_modified" });
      }
      const headers = Object.fromEntries(response.headers.entries());
      const body = await readJson(response);
      if (!response.ok) {
        return err(classifyGitHubFailure(host, provider, { status: response.status, headers, message: bodyMessage(body) }));
      }
      return ok({ status: "ok", body, etag: headers.etag ?? null, link: headers.link ?? null });
    },
  };
}

