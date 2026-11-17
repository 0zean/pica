import type { Result } from "../result.ts";
import type { Branch } from "./branches.ts";
import type { FileDiff } from "./diff.ts";
import type { GitError } from "./errors.ts";
import type { Commit } from "./log.ts";
import type { PushResult } from "./push.ts";
import type { Status } from "./status.ts";

// Which two trees a diff compares.
export type DiffTarget =
  | { readonly kind: "unstaged" }
  | { readonly kind: "staged" }
  | { readonly kind: "head" }
  | { readonly kind: "commits"; readonly from: string; readonly to: string };

export interface LogOptions {
  readonly ref?: string;
  readonly maxCount?: number;
  readonly paths?: readonly string[];
}

export interface CommitOptions {
  readonly message: string;
  readonly allowEmpty?: boolean;
}

export interface PushOptions {
  readonly remote: string;
  readonly branch: string;
  readonly setUpstream?: boolean;
  readonly forceWithLease?: boolean;
}

export interface ApplyOptions {
  // Apply to the index instead of the working tree.
  readonly cached: boolean;
  readonly reverse: boolean;
}

export type GitResult<T> = Promise<Result<T, GitError>>;

// Every method takes the repository's working directory. Methods never throw.
export interface GitService {
  status(repo: string): GitResult<Status>;
  diff(repo: string, target: DiffTarget, paths?: readonly string[]): GitResult<FileDiff[]>;
  branches(repo: string): GitResult<Branch[]>;
  log(repo: string, options?: LogOptions): GitResult<Commit[]>;
  stage(repo: string, paths: readonly string[]): GitResult<undefined>;
  commit(repo: string, options: CommitOptions): GitResult<{ readonly hash: string }>;
  push(repo: string, options: PushOptions): GitResult<PushResult>;
}

// A-08: what the review needs beyond GitService to stage, unstage and discard by file or hunk.
export interface GitWorkingChanges {
  // A new file shown against nothing, which `diff` leaves out.
  untrackedDiff(repo: string, path: string): GitResult<FileDiff[]>;
  unstage(repo: string, paths: readonly string[]): GitResult<undefined>;
  // Puts tracked paths back to their staged contents.
  restore(repo: string, paths: readonly string[]): GitResult<undefined>;
  // Deletes untracked paths.
  clean(repo: string, paths: readonly string[]): GitResult<undefined>;
  apply(repo: string, patch: string, options: ApplyOptions): GitResult<undefined>;
}
