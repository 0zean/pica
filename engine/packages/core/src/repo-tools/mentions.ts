import { findRepo, type RepoRef } from "./refs.ts";
import { repoRelativePath } from "./repo-path.ts";

export interface LineSpan {
  readonly start: number;
  readonly end: number;
}

interface MentionBase {
  // The mention as written, and where it sits in the text (`end` is exclusive).
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly repoName: string;
  readonly path: string;
}

export type RepoMention =
  | (MentionBase & { readonly kind: "resolved"; readonly repo: RepoRef; readonly lines?: LineSpan })
  | (MentionBase & { readonly kind: "ambiguous"; readonly candidates: readonly string[] })
  | (MentionBase & { readonly kind: "missing" })
  | (MentionBase & { readonly kind: "invalid_path"; readonly repo: RepoRef });

// `@repo:path`, `@owner/repo:path`, optionally ending `:12` or `:12-20`. `@repo:` names the root.
// The `@` must start the text or follow whitespace or an opening bracket or quote, so e-mail
// addresses and `npm@1:x` stay text.
const mentionPattern = /(^|[\s([{"'`])@([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?):(\S*)/g;
const trailingPunctuation = /[.,;!?)\]}"'`]+$/;
const lineSuffix = /:(\d+)(?:-(\d+))?$/;

export function parseRepoMentions(text: string, refs: readonly RepoRef[]): readonly RepoMention[] {
  const mentions: RepoMention[] = [];
  for (const match of text.matchAll(mentionPattern)) {
    const lead = match[1] ?? "";
    const repoName = match[2] ?? "";
    const tail = (match[3] ?? "").replace(trailingPunctuation, "");
    const start = match.index + lead.length;
    const raw = `@${repoName}:${tail}`;
    mentions.push(resolveMention({ raw, start, end: start + raw.length, repoName }, tail, refs));
  }
  return mentions;
}

function resolveMention(
  base: Omit<MentionBase, "path">,
  tail: string,
  refs: readonly RepoRef[],
): RepoMention {
  const suffix = lineSuffix.exec(tail);
  const lines = suffix === null ? undefined : lineSpan(suffix[1], suffix[2]);
  const written = suffix === null ? tail : tail.slice(0, suffix.index);
  const repo = findRepo(refs, base.repoName);
  if (!repo.ok) {
    return repo.error.code === "repo_tools.repo_ambiguous"
      ? { ...base, path: written, kind: "ambiguous", candidates: repo.error.candidates ?? [] }
      : { ...base, path: written, kind: "missing" };
  }
  const path = repoRelativePath(written);
  if (!path.ok) {
    return { ...base, path: written, kind: "invalid_path", repo: repo.value };
  }
  return { ...base, path: path.value, kind: "resolved", repo: repo.value, ...(lines === undefined ? {} : { lines }) };
}

function lineSpan(first: string | undefined, last: string | undefined): LineSpan {
  const start = Number(first);
  const end = last === undefined ? start : Number(last);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
