import type { GitHubAuthResult } from "../github/credentials.ts";

// A repository on GitHub, as `owner/name`.
export interface GitHubRepoRef {
  readonly owner: string;
  readonly name: string;
}

export interface PullRequestCreate {
  readonly repo: GitHubRepoRef;
  // Branch with the changes.
  readonly head: string;
  // Branch the changes merge into.
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly draft?: boolean;
}

export interface PullRequestRef {
  readonly repo: GitHubRepoRef;
  readonly number: number;
  readonly url: string;
}

// Opens and edits pull requests on one GitHub host. Methods never throw.
export interface PullRequestClient {
  create(request: PullRequestCreate): GitHubAuthResult<PullRequestRef>;
  updateBody(pullRequest: PullRequestRef, body: string): GitHubAuthResult<undefined>;
}
