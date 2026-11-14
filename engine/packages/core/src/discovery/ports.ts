import type { GitHubAuthResult } from "../github/credentials.ts";
import type { GitHubHost } from "../github/hosts.ts";

// One page of a GitHub REST listing. `not_modified` is a 304 answer to a request sent with an ETag.
export type GitHubPage =
  | { readonly status: "not_modified" }
  | {
      readonly status: "ok";
      readonly body: unknown;
      readonly etag: string | null;
      // The raw `Link` header; pagination follows its rel="next" URL.
      readonly link: string | null;
    };

// An authenticated GET against one host's REST API. `target` is an API path or an absolute URL from a `Link` header.
export interface GitHubRestClient {
  readonly host: GitHubHost;
  get(target: string, etag: string | null): GitHubAuthResult<GitHubPage>;
}
