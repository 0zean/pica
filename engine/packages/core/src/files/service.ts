import { isInside } from "../policy/paths.ts";
import { joinRepoPath, repoRelativePath } from "../repo-tools/repo-path.ts";
import { compareText } from "../repo-tools/refs.ts";
import { err, ok, type Result } from "../result.ts";
import type { Repo } from "../store/entities.ts";
import { filesError, type FilesError } from "./errors.ts";
import { createFileIndex } from "./file-index.ts";
import { defaultFilesLimits, type FileKind, type FilesLimits, type FilesServiceDeps } from "./ports.ts";
import { compareRanked } from "./ranking.ts";

export type FilesResult<T> = Promise<Result<T, FilesError>>;

export interface FileEntryInfo {
  readonly repoId: string;
  // Repo-relative, without a trailing slash.
  readonly path: string;
  readonly kind: FileKind;
  // Null for a directory.
  readonly sizeBytes: number | null;
}

export interface FileText {
  readonly text: string;
  readonly truncated: boolean;
  readonly sizeBytes: number;
}

export interface QuickOpenMatch {
  readonly repoId: string;
  readonly path: string;
  readonly score: number;
}

// A-09 (docs/files.md): the file tree, the viewer and quick open, over git's view of each repo's
// working tree (R-08 `RepoFiles`), so ignored files and `.git` never appear.
export interface FilesService {
  // The immediate children of `directory` ("" is the root): directories first, each group in code-point order.
  list(repoId: string, directory: string): FilesResult<readonly FileEntryInfo[]>;
  read(repoId: string, path: string): FilesResult<FileText>;
  // The best `limit` paths across the workspace's cloned repos. An empty query matches nothing but
  // lists the repos, so the first keystroke after opening finds them listed.
  quickOpen(workspaceId: string, query: string, limit: number): FilesResult<readonly QuickOpenMatch[]>;
}

export function createFilesService(deps: FilesServiceDeps): FilesService {
  const limits: FilesLimits = { ...defaultFilesLimits, ...deps.limits };
  const index = createFileIndex(deps, limits.indexMaxAgeMs);

  function rootOf(repo: Repo): Result<string, FilesError> {
    if (repo.cloneState !== "ready" || repo.localPath === null) {
      return err(filesError("files.not_cloned", `repo ${repo.id} is not cloned yet`));
    }
    return ok(repo.localPath);
  }

  async function located(repoId: string, path: string): FilesResult<{ readonly root: string; readonly relative: string }> {
    const repo = deps.repo(repoId);
    if (!repo.ok) return repo;
    const root = rootOf(repo.value);
    if (!root.ok) return root;
    const relative = repoRelativePath(path);
    if (!relative.ok) return err(outsideRepo(path));
    const realRoot = await deps.realPath(root.value);
    const real = await deps.realPath(joinRepoPath(root.value, relative.value));
    if (!isInside(real, realRoot)) return err(outsideRepo(path));
    return ok({ root: root.value, relative: relative.value });
  }

  return {
    async list(repoId, directory) {
      const target = await located(repoId, directory);
      if (!target.ok) return target;
      const listing = await index.fresh(target.value.root);
      if (!listing.ok) return listing;
      const children = childrenOf(listing.value.paths, target.value.relative);
      if (children.length === 0 && target.value.relative !== "") {
        return err(filesError("files.not_found", `${directory} is not a directory in this repo`));
      }
      const entries = await Promise.all(
        children.slice(0, limits.maxListEntries).map(async (child): Promise<FileEntryInfo> => {
          if (child.directory) return { repoId, path: child.path, kind: "directory", sizeBytes: null };
          const info = await deps.stat(joinRepoPath(target.value.root, child.path));
          return { repoId, path: child.path, kind: info?.kind === "symlink" ? "symlink" : "file", sizeBytes: info?.sizeBytes ?? null };
        }),
      );
      return ok(entries);
    },

    async read(repoId, path) {
      const target = await located(repoId, path);
      if (!target.ok) return target;
      const absolute = joinRepoPath(target.value.root, target.value.relative);
      const info = await deps.stat(absolute);
      if (info === null || info.kind !== "file") {
        return err(filesError("files.not_found", `${path} is not a file in this repo`));
      }
      const content = await deps.files.readFile(absolute, limits.maxReadBytes);
      if (!content.ok) return err(filesError("files.io_failed", content.error.message));
      if (content.value.kind === "binary") return err(filesError("files.binary", `${path} is a binary file`));
      if (content.value.kind === "not_a_file") return err(filesError("files.not_found", `${path} is not a file in this repo`));
      return ok({ text: content.value.text, truncated: content.value.truncated, sizeBytes: info.sizeBytes });
    },

    async quickOpen(workspaceId, query, limit) {
      const repos = deps.workspaceRepos(workspaceId);
      if (!repos.ok) return repos;
      const wanted = Math.min(Math.max(limit, 0), limits.maxQuickOpenHits);
      const cloned = repos.value.filter((repo) => rootOf(repo).ok);
      const listings = await Promise.all(cloned.map(async (repo) => ({ repo, listing: await index.current(repo.localPath ?? "") })));
      const matches: QuickOpenMatch[] = [];
      for (const { repo, listing } of listings) {
        if (!listing.ok) return listing;
        for (const ranked of listing.value.ranker.rank(query, wanted)) {
          matches.push({ repoId: repo.id, path: ranked.path, score: ranked.score });
        }
      }
      return ok(matches.sort((a, b) => compareRanked(a, b) || compareText(a.repoId, b.repoId)).slice(0, wanted));
    },
  };
}

function outsideRepo(path: string): FilesError {
  return filesError("files.outside_repo", `"${path}" is outside the repo`);
}

interface Child {
  readonly path: string;
  readonly directory: boolean;
}

// The children of `directory` in the sorted listing, found by binary search for its prefix.
function childrenOf(paths: readonly string[], directory: string): readonly Child[] {
  const prefix = directory === "" ? "" : `${directory}/`;
  let at = lowerBound(paths, prefix);
  const directories: Child[] = [];
  const files: Child[] = [];
  let lastDirectory = "";
  for (; at < paths.length; at += 1) {
    const path = paths[at] ?? "";
    if (!path.startsWith(prefix)) break;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      files.push({ path, directory: false });
      continue;
    }
    const child = `${prefix}${rest.slice(0, slash)}`;
    if (child !== lastDirectory) directories.push({ path: child, directory: true });
    lastDirectory = child;
  }
  return [...directories.sort((a, b) => compareText(a.path, b.path)), ...files];
}

function lowerBound(paths: readonly string[], value: string): number {
  let low = 0;
  let high = paths.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((paths[middle] ?? "") < value) low = middle + 1;
    else high = middle;
  }
  return low;
}
