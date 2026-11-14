import type { GitError } from "../git/errors.ts";
import { err, ok, type Result } from "../result.ts";
import { buildRepoCard } from "./build.ts";
import { cardInputFiles } from "./manifests.ts";
import type { RepoCardCache, RepoCardCacheError, RepoCardSource } from "./ports.ts";
import { byPath } from "./paths.ts";
import { defaultRepoCardMaxBytes, renderRepoCard } from "./render.ts";

// Bumped whenever card content or layout changes, so older cached cards are rebuilt.
const cardFormatVersion = 1;

export interface RepoCardTarget {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface RepoCardResult {
  readonly text: string;
  readonly commit: string;
  readonly fromCache: boolean;
  // Set when the card was built but could not be cached; the card itself is still valid.
  readonly cacheError?: RepoCardCacheError;
}

export interface RepoCardService {
  card(repo: RepoCardTarget): Promise<Result<RepoCardResult, GitError>>;
  // Cards for several repos joined in name order, for injection at session start (§6).
  workspaceCards(repos: readonly RepoCardTarget[]): Promise<Result<string, GitError>>;
}

export interface RepoCardServiceDeps {
  readonly source: RepoCardSource;
  readonly cache: RepoCardCache;
  readonly maxBytes?: number;
}

export function createRepoCardService(deps: RepoCardServiceDeps): RepoCardService {
  const maxBytes = deps.maxBytes ?? defaultRepoCardMaxBytes;
  const cacheKey = (commit: string): string => `v${String(cardFormatVersion)}:${String(maxBytes)}:${commit}`;

  async function build(repo: RepoCardTarget, commit: string): Promise<Result<string, GitError>> {
    const paths = await deps.source.listFiles(repo.path, commit);
    if (!paths.ok) return paths;
    const files = new Map<string, string>();
    for (const path of cardInputFiles(paths.value)) {
      const content = await deps.source.readFile(repo.path, commit, path);
      if (!content.ok) return content;
      if (content.value !== null) files.set(path, content.value);
    }
    const card = buildRepoCard({ name: repo.name, commit, paths: paths.value, files });
    return ok(renderRepoCard(card, maxBytes));
  }

  async function card(repo: RepoCardTarget): Promise<Result<RepoCardResult, GitError>> {
    const head = await deps.source.headCommit(repo.path);
    if (!head.ok) return head;
    const commit = head.value;
    const key = cacheKey(commit);
    const cached = await deps.cache.get(repo.id);
    if (cached.ok && cached.value?.key === key) {
      return ok({ text: cached.value.text, commit, fromCache: true });
    }
    const built = await build(repo, commit);
    if (!built.ok) return built;
    const stored = await deps.cache.put(repo.id, { key, text: built.value });
    const result = { text: built.value, commit, fromCache: false };
    return ok(stored.ok ? result : { ...result, cacheError: stored.error });
  }

  return {
    card,
    async workspaceCards(repos) {
      const texts: string[] = [];
      for (const repo of [...repos].sort((a, b) => byPath(a.name, b.name) || byPath(a.id, b.id))) {
        const result = await card(repo);
        if (!result.ok) return err(result.error);
        texts.push(result.value.text);
      }
      return ok(texts.join("\n\n"));
    },
  };
}
