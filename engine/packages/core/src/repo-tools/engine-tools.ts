import type { JsonObject, JsonValue } from "../json.ts";
import { err, ok, type Result } from "../result.ts";
import type { EngineTool, EngineToolOutput } from "../runtime/port.ts";
import { repoToolError, type RepoToolError } from "./errors.ts";
import { formatHit } from "./search.ts";
import type { RepoListing, RepoReadResult, RepoSearchResult, RepoTools } from "./service.ts";

export const repoToolNames = ["repo_list", "repo_read", "repo_search"] as const;

const repoParameter = { type: "string", description: "Repo name as repo_list shows it, or owner/name." };

// R-08: the model-facing tools over the session's workspace repos.
export function repoEngineTools(tools: RepoTools): readonly EngineTool[] {
  return [
    {
      name: "repo_list",
      description:
        "List the repos in this workspace, or with `repo` the files and directories under `path` in that repo.",
      parameters: schema({ repo: repoParameter, path: { type: "string", description: "Directory inside the repo; default the root." } }, []),
      invoke: (args) => run(args, async (input) => tools.list({ ...optional(input, "repo"), ...optional(input, "path") }), listText),
    },
    {
      name: "repo_read",
      description: "Read a file from a workspace repo, optionally a line range. Paths are relative to the repo root.",
      parameters: schema(
        {
          repo: repoParameter,
          path: { type: "string" },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
        },
        ["repo", "path"],
      ),
      invoke: (args) =>
        run(args, async (input) => {
          const repo = required(input, "repo");
          const path = required(input, "path");
          if (!repo.ok) return repo;
          if (!path.ok) return path;
          return tools.read({ repo: repo.value, path: path.value, ...lineArgs(input) });
        }, readText),
    },
    {
      name: "repo_search",
      description:
        "Search the workspace repos for a literal string. Hits are `repo:path:line: text`, ordered by repo, path and line.",
      parameters: schema(
        {
          query: { type: "string" },
          repo: repoParameter,
          path: { type: "string", description: "Glob over repo-relative paths, e.g. `src/**/*.ts`." },
          caseSensitive: { type: "boolean" },
          limit: { type: "integer", minimum: 1 },
        },
        ["query"],
      ),
      invoke: (args) =>
        run(args, async (input) => {
          const query = required(input, "query");
          if (!query.ok) return query;
          return tools.search({
            query: query.value,
            ...optional(input, "repo"),
            ...optional(input, "path"),
            ...(typeof input.caseSensitive === "boolean" ? { caseSensitive: input.caseSensitive } : {}),
            ...(typeof input.limit === "number" ? { limit: Math.floor(input.limit) } : {}),
          });
        }, searchText),
    },
  ];
}

async function run<T>(
  args: JsonValue,
  call: (input: JsonObject) => Promise<Result<T, RepoToolError>>,
  render: (value: T) => string,
): Promise<EngineToolOutput> {
  if (!isJsonObject(args)) {
    return failure(repoToolError("repo_tools.invalid_arguments", "arguments must be an object"));
  }
  const result = await call(args);
  return result.ok ? { ok: true, text: render(result.value) } : failure(result.error);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(error: RepoToolError): EngineToolOutput {
  return { ok: false, text: `${error.code}: ${error.message}` };
}

function schema(properties: JsonObject, requiredKeys: readonly string[]): JsonObject {
  return { type: "object", properties, required: [...requiredKeys], additionalProperties: false };
}

function required(input: JsonObject, key: string): Result<string, RepoToolError> {
  const value = input[key];
  return typeof value === "string" && value !== ""
    ? ok(value)
    : err(repoToolError("repo_tools.invalid_arguments", `"${key}" must be a non-empty string`));
}

function optional<K extends string>(input: JsonObject, key: K): Partial<Record<K, string>> {
  const value = input[key];
  return typeof value === "string" && value !== "" ? ({ [key]: value } as Partial<Record<K, string>>) : {};
}

function lineArgs(input: JsonObject): { startLine?: number; endLine?: number } {
  return {
    ...(typeof input.startLine === "number" ? { startLine: Math.floor(input.startLine) } : {}),
    ...(typeof input.endLine === "number" ? { endLine: Math.floor(input.endLine) } : {}),
  };
}

function listText(listing: RepoListing): string {
  if (listing.kind === "repos") {
    if (listing.repos.length === 0) return "This workspace has no repos.";
    return listing.repos
      .map((repo) => `${repo.mention}${repo.mention === repo.qualifiedName ? "" : ` (${repo.qualifiedName})`}${repo.cloneState === "ready" ? "" : ` [${repo.cloneState}]`}`)
      .join("\n");
  }
  const lines = listing.entries.map((entry) => `${listing.repo}:${listing.path === "" ? "" : `${listing.path}/`}${entry}`);
  if (listing.truncated) lines.push(`… more entries; list a subdirectory`);
  return lines.length === 0 ? `${listing.repo}:${listing.path} is empty` : lines.join("\n");
}

function readText(read: RepoReadResult): string {
  const header = `${read.repo}:${read.path} lines ${String(read.startLine)}-${String(read.endLine)} of ${String(read.totalLines)}`;
  const more = read.truncated ? `\n… truncated; read from line ${String(read.endLine + 1)}` : "";
  return `${header}\n${read.text}${more}`;
}

function searchText(search: RepoSearchResult): string {
  const lines = search.hits.length === 0 ? ["No matches."] : search.hits.map(formatHit);
  if (search.truncated) lines.push(`… more matches; narrow with repo or path`);
  if (search.skipped.length > 0) lines.push(`Not searched (not cloned): ${search.skipped.join(", ")}`);
  return lines.join("\n");
}
