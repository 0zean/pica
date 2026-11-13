import { parseFailed, type GitError } from "../git/errors.ts";
import { ok, type Result } from "../result.ts";

// Arguments whose output parseWorktreeList reads: NUL after each attribute, an extra NUL after each worktree.
export const worktreeListArgs = ["worktree", "list", "--porcelain", "-z"] as const;

export interface WorktreeInfo {
  readonly path: string;
  // The checked-out commit; null for a bare repository or a branch with no commits yet.
  readonly head: string | null;
  // The short branch name; null when HEAD is detached or the repository is bare.
  readonly branch: string | null;
  readonly main: boolean;
  readonly bare: boolean;
  readonly locked: boolean;
  // Git's directory for this worktree no longer exists on disk.
  readonly prunable: boolean;
}

export function parseWorktreeList(raw: string): Result<WorktreeInfo[], GitError> {
  const worktrees: WorktreeInfo[] = [];
  for (const record of raw.split("\0\0").filter((candidate) => candidate !== "")) {
    const parsed = parseRecord(record.split("\0").filter((line) => line !== ""), worktrees.length === 0);
    if (parsed === undefined) {
      return parseFailed("worktree list", `bad record "${record.replaceAll("\0", " | ")}"`);
    }
    worktrees.push(parsed);
  }
  return ok(worktrees);
}

function parseRecord(lines: readonly string[], main: boolean): WorktreeInfo | undefined {
  const [first = "", ...rest] = lines;
  if (!first.startsWith("worktree ")) return undefined;
  const attributes = new Map(rest.map(splitOnce));
  const head = attributes.get("HEAD");
  const branch = attributes.get("branch");
  if (head !== undefined && !/^[0-9a-f]+$/.test(head)) return undefined;
  if (branch !== undefined && !branch.startsWith("refs/heads/")) return undefined;
  return {
    path: first.slice("worktree ".length),
    head: head === undefined || /^0+$/.test(head) ? null : head,
    branch: branch === undefined ? null : branch.slice("refs/heads/".length),
    main,
    bare: attributes.has("bare"),
    locked: attributes.has("locked"),
    prunable: attributes.has("prunable"),
  };
}

function splitOnce(line: string): [string, string] {
  const space = line.indexOf(" ");
  return space === -1 ? [line, ""] : [line.slice(0, space), line.slice(space + 1)];
}
