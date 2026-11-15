import type { McpImportPlatform } from "@pica/protocol";
import type { ConfigIssue } from "../config/errors.ts";
import { importForeign, isRecord } from "../mcp/import/foreign.ts";
import type { ForeignImport, ForeignMcpFormat } from "../mcp/import/foreign.ts";
import {
  claudeCodeMcpFormat,
  claudeDesktopMcpFormat,
  copilotCliMcpFormat,
  cursorMcpFormat,
  geminiCliMcpFormat,
  mcpJsonFormat,
  vscodeMcpFormat,
  vscodeUserMcpFormat,
  windsurfMcpFormat,
} from "../mcp/import/formats.ts";
import type { McpImportNote, McpServerEntryInput } from "../mcp/types.ts";

export type McpImportFilePlatform = Exclude<McpImportPlatform, "paste">;

// One platform file, read and parsed by an adapter.
export interface McpPlatformFile {
  readonly platform: McpImportFilePlatform;
  readonly file: string;
  readonly value: unknown;
  // The project directory for a project file (`<repo>/.cursor/mcp.json`); absent for user files.
  readonly root?: string;
  readonly home?: string;
}

// A file that exists but could not be read or parsed. It yields no candidates.
export interface McpUnreadablePlatformFile {
  readonly platform: McpImportFilePlatform;
  readonly file: string;
  readonly unreadable: string;
}

export type McpPlatformFileRead = McpPlatformFile | McpUnreadablePlatformFile;

// The servers of one file. Claude Code's file gives one section per project as well.
export interface McpPlatformSection {
  readonly project: string | null;
  readonly imported: ForeignImport;
}

export function readMcpPlatformFile(file: McpPlatformFile): McpPlatformSection[] {
  if (file.platform === "claude-code") {
    return claudeCodeSections(file);
  }
  return [{ project: file.root ?? null, imported: importForeign(platformFormat(file), file.file, file.value) }];
}

function platformFormat(file: McpPlatformFile): ForeignMcpFormat {
  const context = {
    ...(file.root === undefined ? {} : { root: file.root }),
    ...(file.home === undefined ? {} : { home: file.home }),
  };
  switch (file.platform) {
    case "claude-desktop":
      return claudeDesktopMcpFormat;
    case "claude-code":
      return claudeCodeMcpFormat;
    case "cursor":
      return cursorMcpFormat(context);
    case "windsurf":
      return windsurfMcpFormat;
    case "vscode":
      return file.root === undefined ? vscodeUserMcpFormat(file.home) : vscodeMcpFormat(context);
    case "gemini-cli":
      return geminiCliMcpFormat;
    case "copilot-cli":
      return copilotCliMcpFormat;
    case "mcp-json":
      return mcpJsonFormat;
  }
}

// `~/.claude.json`: user servers at the top, local servers under `projects.<dir>.mcpServers`.
function claudeCodeSections(file: McpPlatformFile): McpPlatformSection[] {
  const sections: McpPlatformSection[] = [
    { project: null, imported: importForeign(claudeCodeMcpFormat, file.file, file.value) },
  ];
  const projects = isRecord(file.value) ? file.value["projects"] : undefined;
  if (!isRecord(projects)) {
    return sections;
  }
  for (const [dir, project] of Object.entries(projects)) {
    if (!isRecord(project) || project["mcpServers"] === undefined) {
      continue;
    }
    const imported = importForeign(claudeCodeMcpFormat, file.file, project);
    sections.push({ project: dir, imported: prefixed(imported, ["projects", dir]) });
  }
  return sections;
}

function prefixed(imported: ForeignImport, prefix: readonly string[]): ForeignImport {
  const at = (keyPath: string): string => [...prefix, ...(keyPath === "" ? [] : [keyPath])].join(".");
  return {
    entries: imported.entries.map((entry): McpServerEntryInput => ({ ...entry, keyPath: [...prefix, ...entry.keyPath] })),
    notes: imported.notes.map((note): McpImportNote => ({ ...note, keyPath: at(note.keyPath) })),
    issues: imported.issues.map((issue): ConfigIssue => ({ ...issue, keyPath: at(issue.keyPath) })),
  };
}
