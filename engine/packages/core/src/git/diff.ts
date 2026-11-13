import { ok, type Result } from "../result.ts";
import { parseFailed, type GitError } from "./errors.ts";
import { unquotePath } from "./quoting.ts";

// Flags after `git diff` that pin the output parseDiff reads, whatever the user's config says.
export const diffArgs = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-relative",
  "--full-index",
  "--find-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--submodule=short",
] as const;

export type FileChange = "modified" | "added" | "deleted" | "renamed" | "copied" | "unmerged";

export interface DiffLine {
  readonly kind: "context" | "added" | "removed";
  readonly text: string;
  readonly noNewlineAtEnd: boolean;
}

export interface Hunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly section: string;
  readonly lines: readonly DiffLine[];
}

export interface SubmoduleChange {
  readonly oldCommit: string | null;
  readonly newCommit: string | null;
  readonly dirty: boolean;
}

export interface FileDiff {
  readonly change: FileChange;
  readonly path: string;
  readonly oldPath: string;
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly similarity: number | null;
  readonly binary: boolean;
  readonly submodule: SubmoduleChange | null;
  readonly hunks: readonly Hunk[];
}

interface Header {
  gitOldPath: string | null;
  gitNewPath: string | null;
  oldPath: string | null;
  newPath: string | null;
  change: FileChange;
  oldMode: string | null;
  newMode: string | null;
  similarity: number | null;
  binary: boolean;
}

type Parsed<T> = Result<T, GitError>;
interface Step<T> {
  readonly value: T;
  readonly next: number;
}

const submoduleMode = "160000";

export function parseDiff(raw: string): Parsed<FileDiff[]> {
  const lines = raw.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const files: FileDiff[] = [];
  let i = 0;
  while (i < lines.length) {
    const file = parseFile(lines, i);
    if (!file.ok) return file;
    files.push(file.value.value);
    i = file.value.next;
  }
  return ok(files);
}

function isFileStart(line: string | undefined): boolean {
  return line !== undefined && /^diff --(git|cc|combined) /.test(line);
}

function parseFile(lines: readonly string[], start: number): Parsed<Step<FileDiff>> {
  const first = lines[start] ?? "";
  const combined = /^diff --(?:cc|combined) (.*)$/.exec(first);
  if (combined !== null) {
    return parseCombined(lines, start, combined[1] ?? "");
  }
  if (!first.startsWith("diff --git ")) {
    return parseFailed("diff", `expected a file header at line ${String(start + 1)}: "${first}"`);
  }
  const header = parseHeader(lines, start);
  if (!header.ok) return header;
  const hunks: Hunk[] = [];
  let i = header.value.next;
  while (lines[i]?.startsWith("@@ ") === true) {
    const hunk = parseHunk(lines, i);
    if (!hunk.ok) return hunk;
    hunks.push(hunk.value.value);
    i = hunk.value.next;
  }
  if (i < lines.length && !isFileStart(lines[i])) {
    return parseFailed("diff", `unexpected line ${String(i + 1)}: "${lines[i] ?? ""}"`);
  }
  const file = buildFile(header.value.value, hunks);
  return file.ok ? ok({ value: file.value, next: i }) : file;
}

// Unmerged paths are reported as combined diffs; only the path is kept.
function parseCombined(lines: readonly string[], start: number, rawPath: string): Parsed<Step<FileDiff>> {
  const path = unquotePath(rawPath);
  if (path === undefined) return parseFailed("diff", `bad path "${rawPath}"`);
  let i = start + 1;
  while (i < lines.length && !isFileStart(lines[i])) {
    i += 1;
  }
  const file: FileDiff = {
    change: "unmerged",
    path,
    oldPath: path,
    oldMode: null,
    newMode: null,
    similarity: null,
    binary: false,
    submodule: null,
    hunks: [],
  };
  return ok({ value: file, next: i });
}

function parseHeader(lines: readonly string[], start: number): Parsed<Step<Header>> {
  const paths = splitGitLinePaths((lines[start] ?? "").slice("diff --git ".length));
  const header: Header = {
    gitOldPath: paths?.[0] ?? null,
    gitNewPath: paths?.[1] ?? null,
    oldPath: null,
    newPath: null,
    change: "modified",
    oldMode: null,
    newMode: null,
    similarity: null,
    binary: false,
  };
  let i = start + 1;
  while (i < lines.length && !isFileStart(lines[i]) && lines[i]?.startsWith("@@ ") !== true) {
    const line = lines[i] ?? "";
    if (!applyHeaderLine(header, line)) {
      return parseFailed("diff", `unknown header line ${String(i + 1)}: "${line}"`);
    }
    i += 1;
  }
  return ok({ value: header, next: i });
}

function applyHeaderLine(header: Header, line: string): boolean {
  const match = /^(old mode|new mode|deleted file mode|new file mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|index|---|\+\+\+) (.*)$/.exec(
    line,
  );
  if (match === null) {
    const binary = /^Binary files .* differ$/.test(line);
    header.binary ||= binary;
    return binary;
  }
  const [, key = "", value = ""] = match;
  switch (key) {
    case "old mode":
      header.oldMode = value;
      return true;
    case "new mode":
      header.newMode = value;
      return true;
    case "deleted file mode":
      header.change = "deleted";
      header.oldMode = value;
      return true;
    case "new file mode":
      header.change = "added";
      header.newMode = value;
      return true;
    case "similarity index":
    case "dissimilarity index":
      header.similarity = Number.parseInt(value, 10);
      return true;
    case "rename from":
    case "copy from":
      header.change = key === "rename from" ? "renamed" : "copied";
      return setPath(header, "oldPath", value, "");
    case "rename to":
    case "copy to":
      return setPath(header, "newPath", value, "");
    case "index":
      return applyIndexLine(header, value);
    case "---":
      return value === "/dev/null" || setPath(header, "oldPath", value.replace(/\t$/, ""), "a/");
    default:
      return value === "/dev/null" || setPath(header, "newPath", value.replace(/\t$/, ""), "b/");
  }
}

function setPath(header: Header, key: "oldPath" | "newPath", raw: string, prefix: string): boolean {
  const path = unquotePath(raw);
  if (path === undefined || !path.startsWith(prefix)) return false;
  header[key] = path.slice(prefix.length);
  return true;
}

function applyIndexLine(header: Header, value: string): boolean {
  const match = /^[0-9a-f]+\.\.[0-9a-f]+(?: (\d+))?$/.exec(value);
  if (match === null) return false;
  if (match[1] !== undefined) {
    header.oldMode = match[1];
    header.newMode = match[1];
  }
  return true;
}

// "a/x b/x": without rename headers both sides name the same path, so the line splits in half.
function splitGitLinePaths(rest: string): [string, string] | undefined {
  const half = (rest.length - 1) / 2;
  if (!Number.isInteger(half) || rest.charAt(half) !== " ") return undefined;
  const left = unquotePath(rest.slice(0, half));
  const right = unquotePath(rest.slice(half + 1));
  if (left?.startsWith("a/") !== true || right?.startsWith("b/") !== true) return undefined;
  return [left.slice(2), right.slice(2)];
}

function parseHunk(lines: readonly string[], start: number): Parsed<Step<Hunk>> {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(lines[start] ?? "");
  if (match === null) return parseFailed("diff", `bad hunk header at line ${String(start + 1)}`);
  const oldLines = Number(match[2] ?? "1");
  const newLines = Number(match[4] ?? "1");
  const body: DiffLine[] = [];
  let oldLeft = oldLines;
  let newLeft = newLines;
  let i = start + 1;
  while (oldLeft > 0 || newLeft > 0 || lines[i]?.startsWith("\\") === true) {
    const line = lines[i];
    const marker = line?.charAt(0);
    const previous = body.at(-1);
    if (marker === "\\" && previous !== undefined) {
      body[body.length - 1] = { ...previous, noNewlineAtEnd: true };
    } else if ((marker === " " || line === "") && oldLeft > 0 && newLeft > 0) {
      body.push({ kind: "context", text: line?.slice(1) ?? "", noNewlineAtEnd: false });
      oldLeft -= 1;
      newLeft -= 1;
    } else if (marker === "-" && oldLeft > 0) {
      body.push({ kind: "removed", text: line?.slice(1) ?? "", noNewlineAtEnd: false });
      oldLeft -= 1;
    } else if (marker === "+" && newLeft > 0) {
      body.push({ kind: "added", text: line?.slice(1) ?? "", noNewlineAtEnd: false });
      newLeft -= 1;
    } else {
      return parseFailed("diff", `bad hunk line ${String(i + 1)}: "${line ?? "<end of input>"}"`);
    }
    i += 1;
  }
  const hunk: Hunk = {
    oldStart: Number(match[1]),
    oldLines,
    newStart: Number(match[3]),
    newLines,
    section: match[5] ?? "",
    lines: body,
  };
  return ok({ value: hunk, next: i });
}

function buildFile(header: Header, hunks: readonly Hunk[]): Parsed<FileDiff> {
  const oldPath = header.oldPath ?? header.gitOldPath;
  const newPath = header.newPath ?? header.gitNewPath;
  const path = header.change === "deleted" ? oldPath : newPath;
  if (path === null) return parseFailed("diff", "a file header names no path");
  const isSubmodule = header.oldMode === submoduleMode || header.newMode === submoduleMode;
  return ok({
    change: header.change,
    path,
    oldPath: header.change === "added" ? path : (oldPath ?? path),
    oldMode: header.oldMode,
    newMode: header.newMode,
    similarity: header.similarity,
    binary: header.binary,
    submodule: isSubmodule ? submoduleChange(hunks) : null,
    hunks,
  });
}

function submoduleChange(hunks: readonly Hunk[]): SubmoduleChange {
  const lines = hunks.flatMap((hunk) => hunk.lines);
  const commitOf = (kind: DiffLine["kind"]): RegExpExecArray | null => {
    const line = lines.find((candidate) => candidate.kind === kind);
    return /^Subproject commit ([0-9a-f]+)(-dirty)?$/.exec(line?.text ?? "");
  };
  const removed = commitOf("removed");
  const added = commitOf("added");
  return {
    oldCommit: removed?.[1] ?? null,
    newCommit: added?.[1] ?? null,
    dirty: added?.[2] !== undefined,
  };
}
