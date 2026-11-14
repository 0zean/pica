import type { GitService } from "../git/port.ts";
import { linkedPullRequestBody } from "./body.ts";
import type { PullRequestClient, PullRequestRef } from "./ports.ts";
import type { ChangeSet, ChangeSetFailure, ChangeSetMember } from "./types.ts";

export interface ChangeSetPullRequestOptions {
  readonly title: string;
  readonly description: string;
  readonly remote: string;
  readonly draft?: boolean;
}

// `link_failed` means the pull request exists but its body could not be updated to link the others.
export type ChangeSetPullRequestOutcome =
  | { readonly repo: string; readonly status: "opened"; readonly pullRequest: PullRequestRef }
  | { readonly repo: string; readonly status: "link_failed"; readonly pullRequest: PullRequestRef; readonly error: ChangeSetFailure }
  | { readonly repo: string; readonly status: "push_failed" | "create_failed"; readonly error: ChangeSetFailure }
  | { readonly repo: string; readonly status: "skipped" };

export interface ChangeSetPullRequests {
  // True only when every repository has an opened, linked pull request.
  readonly complete: boolean;
  readonly outcomes: readonly ChangeSetPullRequestOutcome[];
}

export interface ChangeSetPullRequestDeps {
  readonly git: GitService;
  readonly pullRequests: PullRequestClient;
}

// Pushes each branch and opens its pull request in order, then links every opened pull request to the
// others. The first failure stops further openings; pull requests already opened are kept and still linked,
// because closing them would throw away review state the developer may want.
export async function openChangeSetPullRequests(
  deps: ChangeSetPullRequestDeps,
  changeSet: ChangeSet,
  options: ChangeSetPullRequestOptions,
): Promise<ChangeSetPullRequests> {
  const outcomes: ChangeSetPullRequestOutcome[] = [];
  const opened: PullRequestRef[] = [];
  for (const member of changeSet.members) {
    if (outcomes.some((outcome) => outcome.status === "push_failed" || outcome.status === "create_failed")) {
      outcomes.push({ repo: member.repo, status: "skipped" });
      continue;
    }
    const outcome = await openOne(deps, changeSet, member, options);
    outcomes.push(outcome);
    if (outcome.status === "opened") {
      opened.push(outcome.pullRequest);
    }
  }
  const linked = opened.length > 1 ? await linkAll(deps.pullRequests, changeSet, options, outcomes, opened) : outcomes;
  return { complete: linked.every((outcome) => outcome.status === "opened"), outcomes: linked };
}

async function openOne(
  deps: ChangeSetPullRequestDeps,
  changeSet: ChangeSet,
  member: ChangeSetMember,
  options: ChangeSetPullRequestOptions,
): Promise<ChangeSetPullRequestOutcome> {
  const pushed = await deps.git.push(member.worktree.path, {
    remote: options.remote,
    branch: changeSet.branch,
    setUpstream: true,
  });
  if (!pushed.ok) {
    return { repo: member.repo, status: "push_failed", error: { code: pushed.error.code, message: pushed.error.message } };
  }
  const created = await deps.pullRequests.create({
    repo: member.github,
    head: changeSet.branch,
    base: member.baseBranch,
    title: options.title,
    body: options.description,
    ...(options.draft === undefined ? {} : { draft: options.draft }),
  });
  if (!created.ok) {
    return { repo: member.repo, status: "create_failed", error: { code: created.error.code, message: created.error.message } };
  }
  return { repo: member.repo, status: "opened", pullRequest: created.value };
}

async function linkAll(
  client: PullRequestClient,
  changeSet: ChangeSet,
  options: ChangeSetPullRequestOptions,
  outcomes: readonly ChangeSetPullRequestOutcome[],
  opened: readonly PullRequestRef[],
): Promise<ChangeSetPullRequestOutcome[]> {
  const linked: ChangeSetPullRequestOutcome[] = [];
  for (const outcome of outcomes) {
    if (outcome.status !== "opened") {
      linked.push(outcome);
      continue;
    }
    const body = linkedPullRequestBody(options.description, changeSet.branch, outcome.pullRequest, opened);
    const updated = await client.updateBody(outcome.pullRequest, body);
    linked.push(
      updated.ok
        ? outcome
        : { ...outcome, status: "link_failed", error: { code: updated.error.code, message: updated.error.message } },
    );
  }
  return linked;
}
