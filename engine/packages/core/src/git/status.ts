import { ok, type Result } from "../result.ts";
import { parseFailed, type GitError } from "./errors.ts";

// Arguments after `git status` whose output parseStatus reads.
export const statusArgs = ["--porcelain=v2", "-z", "--branch", "--untracked-files=all"] as const;

export type FileState =
  | "unmodified"
  | "modified"
  | "typeChanged"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "unmerged";

export interface SubmoduleStatus {
  readonly commitChanged: boolean;
  readonly trackedChanges: boolean;
  readonly untrackedChanges: boolean;
}

interface EntryStates {
  readonly path: string;
  readonly index: FileState;
  readonly worktree: FileState;
  readonly submodule: SubmoduleStatus | null;
}

export interface ChangedEntry extends EntryStates {
  readonly kind: "changed";
}

export interface RenamedEntry extends EntryStates {
  readonly kind: "renamed" | "copied";
  readonly originalPath: string;
  readonly similarity: number;
}

export interface UnmergedEntry extends EntryStates {
  readonly kind: "unmerged";
}

export interface UntrackedEntry {
  readonly kind: "untracked" | "ignored";
  readonly path: string;
}

export type StatusEntry = ChangedEntry | RenamedEntry | UnmergedEntry | UntrackedEntry;

export interface BranchStatus {
  readonly commit: string | null;
  readonly head: string | null;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
}

export interface Status {
  readonly branch: BranchStatus;
  readonly entries: readonly StatusEntry[];
}

type Parsed<T> = Result<T, GitError>;

const fileStates: Readonly<Record<string, FileState>> = {
  ".": "unmodified",
  M: "modified",
  T: "typeChanged",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "unmerged",
};

export function parseStatus(raw: string): Parsed<Status> {
  const records = raw.split("\0");
  if (records.at(-1) === "") {
    records.pop();
  }
  const branch = { commit: null, head: null, upstream: null, ahead: null, behind: null };
  const entries: StatusEntry[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i] ?? "";
    if (record.startsWith("# ")) {
      const header = parseBranchHeader(record, branch);
      if (!header.ok) return header;
      continue;
    }
    const entry = parseEntry(record, records[i + 1]);
    if (!entry.ok) return entry;
    if (entry.value.kind === "renamed" || entry.value.kind === "copied") {
      i += 1;
    }
    entries.push(entry.value);
  }
  return ok({ branch, entries });
}

function parseBranchHeader(
  record: string,
  branch: { -readonly [K in keyof BranchStatus]: BranchStatus[K] },
): Parsed<undefined> {
  const [name = "", ...rest] = record.slice(2).split(" ");
  const value = rest.join(" ");
  if (name === "branch.oid") {
    branch.commit = value === "(initial)" ? null : value;
  } else if (name === "branch.head") {
    branch.head = value === "(detached)" ? null : value;
  } else if (name === "branch.upstream") {
    branch.upstream = value;
  } else if (name === "branch.ab") {
    const counts = /^\+(\d+) -(\d+)$/.exec(value);
    if (counts === null) return parseFailed("status", `bad ahead/behind header "${record}"`);
    branch.ahead = Number(counts[1]);
    branch.behind = Number(counts[2]);
  }
  return ok(undefined);
}

function parseEntry(record: string, nextRecord: string | undefined): Parsed<StatusEntry> {
  const type = record.slice(0, 2);
  if (type === "? " || type === "! ") {
    return ok({ kind: type === "? " ? "untracked" : "ignored", path: record.slice(2) });
  }
  if (type === "1 ") {
    return parseTracked(record, 8, (states) => ok({ kind: "changed", ...states }));
  }
  if (type === "u ") {
    return parseTracked(record, 10, (states) => ok({ kind: "unmerged", ...states }));
  }
  if (type === "2 ") {
    return parseTracked(record, 9, (states, fields) => {
      const score = /^([RC])(\d+)$/.exec(fields[8] ?? "");
      if (score === null || nextRecord === undefined) {
        return parseFailed("status", `bad rename record "${record}"`);
      }
      const kind = score[1] === "R" ? "renamed" : "copied";
      return ok({ kind, ...states, originalPath: nextRecord, similarity: Number(score[2]) });
    });
  }
  return parseFailed("status", `unknown record "${record}"`);
}

function parseTracked(
  record: string,
  fieldCount: number,
  build: (states: EntryStates, fields: readonly string[]) => Parsed<StatusEntry>,
): Parsed<StatusEntry> {
  const split = splitFields(record, fieldCount);
  if (split === undefined) return parseFailed("status", `too few fields in "${record}"`);
  const [, xy = "", sub = ""] = split.fields;
  const index = fileStates[xy.charAt(0)];
  const worktree = fileStates[xy.charAt(1)];
  const submodule = parseSubmodule(sub);
  if (xy.length !== 2 || index === undefined || worktree === undefined || submodule === undefined) {
    return parseFailed("status", `bad state fields in "${record}"`);
  }
  return build({ path: split.rest, index, worktree, submodule }, split.fields);
}

function parseSubmodule(field: string): SubmoduleStatus | null | undefined {
  if (field === "N...") return null;
  const flags = /^S([C.])([M.])([U.])$/.exec(field);
  if (flags === null) return undefined;
  return {
    commitChanged: flags[1] === "C",
    trackedChanges: flags[2] === "M",
    untrackedChanges: flags[3] === "U",
  };
}

// Paths may contain spaces, so only the leading fixed fields are split on them.
function splitFields(record: string, count: number): { fields: string[]; rest: string } | undefined {
  const fields: string[] = [];
  let start = 0;
  for (let n = 0; n < count; n += 1) {
    const end = record.indexOf(" ", start);
    if (end === -1) return undefined;
    fields.push(record.slice(start, end));
    start = end + 1;
  }
  return { fields, rest: record.slice(start) };
}
