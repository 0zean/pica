import type { RepoFiles } from "../repo-tools/ports.ts";
import type { Result } from "../result.ts";
import type { RealPathResolver } from "../sandbox/real-paths.ts";
import type { Repo } from "../store/entities.ts";
import type { FilesError } from "./errors.ts";

export type FileKind = "file" | "directory" | "symlink";

export interface FileInfo {
  readonly kind: FileKind;
  readonly sizeBytes: number;
}

// Port: what is at a path, without following a symlink; null when nothing is.
export type FileStat = (absolutePath: string) => Promise<FileInfo | null>;

export interface FilesLimits {
  // Listings older than this are listed again; quick open answers from the old one meanwhile.
  readonly indexMaxAgeMs: number;
  readonly maxReadBytes: number;
  readonly maxQuickOpenHits: number;
  readonly maxListEntries: number;
}

export const defaultFilesLimits: FilesLimits = {
  indexMaxAgeMs: 10_000,
  maxReadBytes: 1024 * 1024,
  maxQuickOpenHits: 200,
  maxListEntries: 5_000,
};

export interface FilesServiceDeps {
  // R-06: the repos of a workspace, and one repo; an error when it does not exist.
  workspaceRepos(workspaceId: string): Result<readonly Repo[], FilesError>;
  repo(repoId: string): Result<Repo, FilesError>;
  // R-08: git's view of the working tree, and reads that never follow a symlink.
  readonly files: RepoFiles;
  readonly stat: FileStat;
  readonly realPath: RealPathResolver;
  readonly now: () => number;
  readonly limits?: Partial<FilesLimits>;
}
