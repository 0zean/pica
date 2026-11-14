import { isInside } from "../policy/paths.ts";
import { err, ok, type Result } from "../result.ts";
import { repoToolError, type RepoToolError } from "./errors.ts";
import { defaultRepoToolLimits, type RepoSummary, type RepoToolLimits, type RepoToolsDeps } from "./ports.ts";
import { compareText, findRepo, repoRefs, type RepoRef } from "./refs.ts";
import { joinRepoPath, outside, repoRelativePath } from "./repo-path.ts";
import { matchLines, pathFilter, sortedPaths, type SearchHit, type SearchQuery } from "./search.ts";

export type RepoToolResult<T> = Promise<Result<T, RepoToolError>>;

export interface RepoListRequest {
  readonly repo?: string;
  readonly path?: string;
}

export type RepoListing =
  | { readonly kind: "repos"; readonly repos: readonly RepoSummary[] }
  // Immediate children of `path`; directories end in "/".
  | { readonly kind: "entries"; readonly repo: string; readonly path: string; readonly entries: readonly string[]; readonly truncated: boolean };

export interface RepoReadRequest {
  readonly repo: string;
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface RepoReadResult {
  readonly repo: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly text: string;
  // More lines exist after `endLine`, or the file was longer than the byte cap.
  readonly truncated: boolean;
}

export interface RepoSearchRequest {
  readonly query: string;
  readonly repo?: string;
  readonly path?: string;
  readonly caseSensitive?: boolean;
  readonly limit?: number;
}

export interface RepoSearchResult {
  readonly hits: readonly SearchHit[];
  readonly truncated: boolean;
  // Repos left out because they are not cloned yet; search them by name to clone them.
  readonly skipped: readonly string[];
}

export interface RepoTools {
  list(request: RepoListRequest): RepoToolResult<RepoListing>;
  read(request: RepoReadRequest): RepoToolResult<RepoReadResult>;
  search(request: RepoSearchRequest): RepoToolResult<RepoSearchResult>;
}

export function createRepoTools(deps: RepoToolsDeps): RepoTools {
  const limits: RepoToolLimits = { ...defaultRepoToolLimits, ...deps.limits };

  async function refs(): RepoToolResult<readonly RepoRef[]> {
    const repos = await deps.repos();
    return repos.ok ? ok(repoRefs(repos.value)) : repos;
  }

  async function named(name: string): RepoToolResult<RepoRef> {
    const all = await refs();
    return all.ok ? findRepo(all.value, name) : all;
  }

  async function rootOf(ref: RepoRef): RepoToolResult<string> {
    let repo = ref.repo;
    if (repo.cloneState !== "ready" && deps.ensureCloned !== undefined) {
      const cloned = await deps.ensureCloned(repo.id);
      if (!cloned.ok) return cloned;
      repo = cloned.value;
    }
    if (repo.cloneState !== "ready" || repo.localPath === null) {
      return err(repoToolError("repo_tools.not_cloned", `${ref.mention} is not cloned`));
    }
    return ok(repo.localPath);
  }

  // The real path of `relative` inside the repo, refused when a symlink leads out of it.
  async function contained(ref: RepoRef, path: string): RepoToolResult<{ readonly root: string; readonly relative: string; readonly real: string }> {
    const relative = repoRelativePath(path);
    if (!relative.ok) return err(outside(`${ref.mention}:${path}`));
    const root = await rootOf(ref);
    if (!root.ok) return root;
    const realRoot = await deps.realPath(root.value);
    const real = await deps.realPath(joinRepoPath(root.value, relative.value));
    if (!isInside(real, realRoot)) return err(outside(`${ref.mention}:${path}`));
    return ok({ root: root.value, relative: relative.value, real });
  }

  return {
    async list(request) {
      if (request.repo === undefined) {
        const all = await refs();
        if (!all.ok) return all;
        const repos = all.value.map((ref) => ({ mention: ref.mention, qualifiedName: ref.qualifiedName, cloneState: ref.repo.cloneState }));
        return ok({ kind: "repos", repos });
      }
      const ref = await named(request.repo);
      if (!ref.ok) return ref;
      const target = await contained(ref.value, request.path ?? "");
      if (!target.ok) return target;
      const files = await deps.files.listFiles(target.value.root);
      if (!files.ok) return files;
      const entries = childEntries(files.value, target.value.relative);
      return ok({
        kind: "entries",
        repo: ref.value.mention,
        path: target.value.relative,
        entries: entries.slice(0, limits.maxListEntries),
        truncated: entries.length > limits.maxListEntries,
      });
    },

    async read(request) {
      const ref = await named(request.repo);
      if (!ref.ok) return ref;
      const target = await contained(ref.value, request.path);
      if (!target.ok) return target;
      const content = await deps.files.readFile(target.value.real, limits.maxReadBytes);
      if (!content.ok) return content;
      const where = `${ref.value.mention}:${target.value.relative}`;
      if (content.value.kind === "not_a_file") {
        return err(repoToolError("repo_tools.not_a_file", `${where} is not a file; use repo_list for directories`));
      }
      if (content.value.kind === "binary") {
        return err(repoToolError("repo_tools.not_a_file", `${where} is a binary file`));
      }
      return ok(lineWindow(ref.value.mention, target.value.relative, content.value, request, limits.maxReadLines));
    },

    async search(request) {
      if (request.query === "") {
        return err(repoToolError("repo_tools.invalid_arguments", "query must not be empty"));
      }
      const scope = await searchScope(request.repo);
      if (!scope.ok) return scope;
      const limit = Math.min(Math.max(1, request.limit ?? limits.defaultResults), limits.maxResults);
      const query = { text: request.query, caseSensitive: request.caseSensitive ?? false };
      const wanted = pathFilter(request.path);
      const hits: SearchHit[] = [];
      const skipped: string[] = [];
      for (const ref of scope.value) {
        // Across the whole workspace, repos not cloned yet are reported rather than cloned.
        const root = request.repo === undefined && ref.repo.cloneState !== "ready" ? undefined : await rootOf(ref);
        if (root === undefined || (!root.ok && request.repo === undefined)) {
          skipped.push(ref.mention);
          continue;
        }
        if (!root.ok) return root;
        const searched = await searchRepo(ref.mention, root.value, listedPaths(wanted), query, limit - hits.length);
        if (!searched.ok) return searched;
        hits.push(...searched.value);
        if (hits.length > limit) return ok({ hits: hits.slice(0, limit), truncated: true, skipped });
      }
      return ok({ hits, truncated: false, skipped });
    },
  };

  function listedPaths(wanted: (path: string) => boolean): (root: string) => RepoToolResult<readonly string[]> {
    return async (root) => {
      const listed = await deps.files.listFiles(root);
      return listed.ok ? ok(sortedPaths(listed.value.filter(wanted))) : listed;
    };
  }

  // Stops one hit past `room`, so the caller can tell the cap was reached.
  async function searchRepo(
    mention: string,
    root: string,
    list: (root: string) => RepoToolResult<readonly string[]>,
    query: SearchQuery,
    room: number,
  ): RepoToolResult<readonly SearchHit[]> {
    const paths = await list(root);
    if (!paths.ok) return paths;
    const hits: SearchHit[] = [];
    for (const path of paths.value) {
      const content = await deps.files.readFile(joinRepoPath(root, path), limits.maxSearchFileBytes);
      if (!content.ok) return content;
      if (content.value.kind !== "text") continue;
      hits.push(...matchLines(mention, path, content.value.text, query));
      if (hits.length > room) break;
    }
    return ok(hits);
  }

  async function searchScope(repo: string | undefined): RepoToolResult<readonly RepoRef[]> {
    if (repo === undefined) return refs();
    const ref = await named(repo);
    return ref.ok ? ok([ref.value]) : ref;
  }
}

function childEntries(files: readonly string[], directory: string): readonly string[] {
  const prefix = directory === "" ? "" : `${directory}/`;
  const entries = new Set<string>();
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    entries.add(slash === -1 ? rest : `${rest.slice(0, slash)}/`);
  }
  return [...entries].sort(compareText);
}

function lineWindow(
  repo: string,
  path: string,
  content: { readonly text: string; readonly truncated: boolean },
  request: RepoReadRequest,
  maxLines: number,
): RepoReadResult {
  const lines = content.text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const totalLines = lines.length;
  const startLine = Math.max(1, request.startLine ?? 1);
  const endLine = Math.min(totalLines, request.endLine ?? totalLines, startLine + maxLines - 1);
  return {
    repo,
    path,
    startLine,
    endLine,
    totalLines,
    text: lines.slice(startLine - 1, endLine).join("\n"),
    truncated: content.truncated || endLine < totalLines,
  };
}
