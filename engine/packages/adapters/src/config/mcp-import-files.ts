import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import { configError, err, mcpServerIdPattern, ok } from "@pica/core";
import type { ConfigError, McpImportFiles, McpImportTarget, McpImportWrite, McpPlatformFileRead, Result } from "@pica/core";
import { parseConfigFile } from "./jsonc.ts";
import { mcpImportFileLocations } from "./mcp-import-paths.ts";
import type { McpImportFileLocation } from "./mcp-import-paths.ts";
import { repoMcpConfigPath, userMcpConfigPath, workspaceMcpConfigPath } from "./mcp-paths.ts";

export interface McpImportFilesOptions {
  readonly homeDir: string;
  // Defaults to the macOS locations in mcp-import-paths.ts.
  readonly locations?: (homeDir: string, repoRoot?: string) => readonly McpImportFileLocation[];
}

const absent = new Set(["ENOENT", "ENOTDIR"]);

export function createMcpImportFiles(options: McpImportFilesOptions): McpImportFiles {
  const locations = options.locations ?? mcpImportFileLocations;
  return {
    discover(repoRoot) {
      return locations(options.homeDir, repoRoot).flatMap((location) => readPlatformFile(location, options.homeDir));
    },

    readTarget(target) {
      const file = mcpTargetFile(options.homeDir, target);
      if (!file.ok) {
        return file;
      }
      const text = readMcpTargetText(file.value);
      if (!text.ok) {
        return text;
      }
      if (text.value === undefined) {
        return ok({ file: file.value, value: undefined });
      }
      const parsed = parseConfigFile(file.value, text.value);
      return parsed.ok ? ok({ file: file.value, value: parsed.value.value }) : parsed;
    },

    writeTarget(target, entries) {
      const file = mcpTargetFile(options.homeDir, target);
      if (!file.ok) {
        return file;
      }
      const text = readMcpTargetText(file.value);
      if (!text.ok) {
        return text;
      }
      const written = writeMcpTargetText(file.value, withEntries(text.value ?? "{}\n", entries));
      return written.ok ? ok({ file: file.value }) : written;
    },
  };
}

// A missing file is no source; one that cannot be read or parsed is listed with the reason.
function readPlatformFile(location: McpImportFileLocation, homeDir: string): McpPlatformFileRead[] {
  let text: string;
  try {
    text = readFileSync(location.file, "utf8");
  } catch (thrown) {
    if (isErrno(thrown) && absent.has(thrown.code)) {
      return [];
    }
    return [{ platform: location.platform, file: location.file, unreadable: errorMessage(thrown) }];
  }
  const parsed = parseConfigFile(location.file, text);
  if (!parsed.ok) {
    return [{ platform: location.platform, file: location.file, unreadable: parsed.error.issues.map((issue) => issue.message).join("; ") }];
  }
  return [
    {
      platform: location.platform,
      file: location.file,
      value: parsed.value.value,
      home: homeDir,
      ...(location.root === undefined ? {} : { root: location.root }),
    },
  ];
}

// Replaces the file atomically; an `mcp.jsonc` may name secret references, so it is private.
export function writeMcpTargetText(file: string, text: string): Result<undefined, ConfigError> {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, text.endsWith("\n") ? text : `${text}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
  } catch (thrown) {
    return err(configError("config.read_failed", file, [{ keyPath: "", message: errorMessage(thrown) }]));
  }
  return ok(undefined);
}

export function mcpTargetFile(homeDir: string, target: McpImportTarget): Result<string, ConfigError> {
  switch (target.scope) {
    case "global":
      return ok(userMcpConfigPath(homeDir));
    case "repo":
      return ok(repoMcpConfigPath(target.repoRoot));
    case "workspace":
      return mcpServerIdPattern.test(target.workspaceId) && !target.workspaceId.includes("..")
        ? ok(workspaceMcpConfigPath(homeDir, target.workspaceId))
        : err(configError("config.invalid", "workspace", [{ keyPath: "workspaceId", message: "not a usable workspace id" }]));
  }
}

export function readMcpTargetText(file: string): Result<string | undefined, ConfigError> {
  try {
    return ok(readFileSync(file, "utf8"));
  } catch (thrown) {
    if (isErrno(thrown) && absent.has(thrown.code)) {
      return ok(undefined);
    }
    return err(configError("config.read_failed", file, [{ keyPath: "", message: errorMessage(thrown) }]));
  }
}

// Edits in place so the user's comments and formatting survive.
function withEntries(text: string, entries: readonly McpImportWrite[]): string {
  let updated = text;
  for (const { id, entry } of entries) {
    const edits = modify(updated, ["servers", id], entry, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } });
    updated = applyEdits(updated, edits);
  }
  return updated;
}

function isErrno(thrown: unknown): thrown is { code: string } {
  return typeof thrown === "object" && thrown !== null && "code" in thrown && typeof thrown.code === "string";
}

function errorMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
