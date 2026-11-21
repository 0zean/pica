export { branchArgs, parseBranches, type Branch } from "./branches.ts";
export {
  diffArgs,
  parseDiff,
  type DiffLine,
  type FileChange,
  type FileDiff,
  type Hunk,
  type SubmoduleChange,
} from "./diff.ts";
export { type GitError, type GitErrorCode } from "./errors.ts";
export { parseGitVersion, type GitInstallation } from "./install.ts";
export { logArgs, parseLog, type Commit } from "./log.ts";
export { hunkPatch, type HunkPatchDirection } from "./hunk-patch.ts";
export type { ApplyOptions, CommitOptions, DiffTarget, GitResult, GitService, GitWorkingChanges, LogOptions, PushOptions } from "./port.ts";
export { parsePush, type PushedRef, type PushOutcome, type PushResult } from "./push.ts";
export {
  parseStatus,
  statusArgs,
  type BranchStatus,
  type ChangedEntry,
  type FileState,
  type RenamedEntry,
  type Status,
  type StatusEntry,
  type SubmoduleStatus,
  type UnmergedEntry,
  type UntrackedEntry,
} from "./status.ts";
