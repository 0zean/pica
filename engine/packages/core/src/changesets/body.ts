import type { PullRequestRef } from "./ports.ts";

export const linkedPullRequestsMarker = "<!-- pica:change-set -->";

// The description plus a section linking every pull request in the change set. Any earlier section
// is replaced, so editing the body again does not stack copies.
export function linkedPullRequestBody(
  description: string,
  branch: string,
  self: PullRequestRef,
  all: readonly PullRequestRef[],
): string {
  const own = stripLinkedSection(description).trimEnd();
  const lines = [
    linkedPullRequestsMarker,
    `Part of change set \`${branch}\` across ${String(all.length)} repositories:`,
    ...all.map((pullRequest) =>
      samePullRequest(pullRequest, self)
        ? `- ${pullRequestName(pullRequest)} (this pull request)`
        : `- ${pullRequestLink(pullRequest)}`,
    ),
  ];
  return own === "" ? lines.join("\n") : `${own}\n\n${lines.join("\n")}`;
}

export function pullRequestName(pullRequest: PullRequestRef): string {
  return `${pullRequest.repo.owner}/${pullRequest.repo.name}#${String(pullRequest.number)}`;
}

function pullRequestLink(pullRequest: PullRequestRef): string {
  return `[${pullRequestName(pullRequest)}](${pullRequest.url})`;
}

function stripLinkedSection(description: string): string {
  const at = description.indexOf(linkedPullRequestsMarker);
  return at === -1 ? description : description.slice(0, at);
}

function samePullRequest(a: PullRequestRef, b: PullRequestRef): boolean {
  return a.url === b.url;
}
