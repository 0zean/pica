import * as z from "zod";
import { Count } from "../common.ts";

export const FileChangeKind = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type_changed",
  "unmerged",
  "untracked",
]);

export const StatusEntry = z.object({
  path: z.string().min(1),
  originalPath: z.string().min(1).nullable(),
  staged: FileChangeKind.nullable(),
  unstaged: FileChangeKind.nullable(),
  submodule: z.boolean(),
});

export const GitStatus = z.object({
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: Count,
  behind: Count,
  entries: z.array(StatusEntry),
});

export const DiffLine = z.object({
  kind: z.enum(["context", "added", "removed"]),
  text: z.string(),
  oldLine: Count.nullable(),
  newLine: Count.nullable(),
});

export const DiffHunk = z.object({
  header: z.string(),
  lines: z.array(DiffLine),
});

export const FileDiff = z.object({
  path: z.string().min(1),
  originalPath: z.string().min(1).nullable(),
  change: FileChangeKind,
  binary: z.boolean(),
  hunks: z.array(DiffHunk),
});

export const Branch = z.object({
  name: z.string().min(1),
  current: z.boolean(),
  upstream: z.string().nullable(),
  headCommit: z.string().min(1),
});

export const Commit = z.object({
  sha: z.string().min(1),
  author: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  subject: z.string(),
});

// Whether the engine can run git (A-15). `missing` covers both no git at all and macOS's `/usr/bin/git`
// stub without the Command Line Tools; `message` then says what running it answered.
export const GitInstall = z.object({
  status: z.enum(["installed", "missing"]),
  version: z.string().min(1).nullable(),
  message: z.string().nullable(),
});
