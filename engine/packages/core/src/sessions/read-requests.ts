import { toolKind } from "../agents/index.ts";
import type { JsonObject, JsonValue } from "../json.ts";
import type { LineRange } from "../policy/index.ts";
import { shellPaths } from "../policy/shell-paths.ts";

// One file a tool call reads. `sized` is false when the call reads names or counts, not content,
// so the file's size does not matter to the large-read gate.
export interface ReadRequest {
  readonly path: string;
  readonly sized: boolean;
  readonly range?: LineRange;
  readonly force?: true;
}

// What a tool call reads, by the argument shapes S-02 recorded (docs/spikes/S-02-tools.json).
export function readRequests(toolName: string, args: JsonValue, cwd: string): readonly ReadRequest[] {
  if (!isJsonObject(args)) {
    return [];
  }
  switch (toolKind(toolName)) {
    case "read":
      return viewRequests(args);
    case "search":
      return searchRequests(toolName, args);
    case "shell":
      return typeof args.command === "string" ? shellRequests(args.command, cwd) : [];
    default:
      return [];
  }
}

// `view`: `path`, `view_range: [start, end]` with -1 meaning end of file, `forceReadLargeFiles`.
function viewRequests(args: JsonObject): readonly ReadRequest[] {
  const { path, view_range: viewRange, forceReadLargeFiles } = args;
  if (typeof path !== "string" || path === "") {
    return [];
  }
  const range = lineRange(viewRange);
  return [
    {
      path,
      sized: true,
      ...(range === undefined ? {} : { range }),
      ...(forceReadLargeFiles === true ? { force: true } : {}),
    },
  ];
}

// `grep` documents `paths` (a string or an array) but models also send `path` (S-02). Its default
// output is file names; `rg`, which some models call instead, prints matching lines by default.
function searchRequests(toolName: string, args: JsonObject): readonly ReadRequest[] {
  const mode = args.output_mode;
  const sized = mode === "content" || (toolName === "rg" && mode === undefined);
  return [args.paths, args.path]
    .flatMap((value) => (typeof value === "string" ? [value] : isJsonArray(value) ? value : []))
    .filter((path): path is string => typeof path === "string" && path !== "")
    .map((path) => ({ path, sized }));
}

// The command line of a shell tool call, by the `bash` argument shape S-02 recorded.
export function shellCommand(toolName: string, args: JsonValue): string | undefined {
  return toolKind(toolName) === "shell" && isJsonObject(args) && typeof args.command === "string" ? args.command : undefined;
}

// A shell command reads whole files through `cat`, `less` and `more` (S-02).
function shellRequests(command: string, cwd: string): readonly ReadRequest[] {
  return shellPaths(command, cwd).flatMap((entry) =>
    entry.printsWhole === true && entry.path !== undefined ? [{ path: entry.path, sized: true }] : [],
  );
}

function lineRange(value: JsonValue | undefined): LineRange | undefined {
  if (!isJsonArray(value) || value.length !== 2) {
    return undefined;
  }
  const [startLine, endLine] = value;
  if (!isLineNumber(startLine) || !isLineNumber(endLine) || endLine === -1) {
    return undefined;
  }
  return { startLine, endLine };
}

function isLineNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}
