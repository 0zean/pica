import type { ForeignMcpFormat, NoteSink } from "./foreign.ts";
import {
  keepText,
  rewriteAnyVariables,
  rewriteCursorVariables,
  rewriteEnvVariables,
  rewriteShellVariables,
  rewriteVsCodeVariables,
  rewriteWindsurfVariables,
} from "./variables.ts";
import type { CursorVariableContext, VsCodeVariableContext } from "./variables.ts";

// `.vscode/mcp.json` (VS Code). `inputs` declares prompts; their answers are keychain secrets here.
export function vscodeMcpFormat(context: VsCodeVariableContext): ForeignMcpFormat {
  return {
    serversKey: "servers",
    topLevelKeys: new Set(["inputs"]),
    typeAliases: {},
    entryKeys: new Set(["type", "command", "args", "env", "cwd", "url", "headers"]),
    rewrite: (text) => rewriteVsCodeVariables(text, context),
  };
}

// `.mcp.json` at a repository root (project-scoped MCP servers).
export const mcpJsonFormat: ForeignMcpFormat = {
  serversKey: "mcpServers",
  topLevelKeys: new Set(),
  typeAliases: {},
  entryKeys: new Set(["type", "command", "args", "env", "url", "headers"]),
  rewrite: rewriteEnvVariables,
};

// `~/.copilot/mcp-config.json` (GitHub Copilot CLI). `tools: ["*"]` means every tool.
export const copilotCliMcpFormat: ForeignMcpFormat = {
  serversKey: "mcpServers",
  topLevelKeys: new Set(),
  typeAliases: { local: "stdio" },
  entryKeys: new Set(["type", "command", "args", "env", "cwd", "url", "headers", "tools"]),
  rewrite: rewriteEnvVariables,
};

// M-07: other agent platforms. Each comment names the published description of the shape.

// Claude Desktop, `claude_desktop_config.json`: local servers only, `command`, `args`, `env`; no
// variable expansion (modelcontextprotocol.io/quickstart/user). Other top-level keys are app settings.
export const claudeDesktopMcpFormat: ForeignMcpFormat = {
  serversKey: "mcpServers",
  topLevelKeys: new Set(),
  typeAliases: {},
  entryKeys: new Set(["type", "command", "args", "env"]),
  rewrite: keepText,
  quietTopLevel: true,
};

// Claude Code, `~/.claude.json`: user servers in `mcpServers`, local (per-project) servers in
// `projects.<dir>.mcpServers`; `type` is stdio, http, or sse, and `${VAR}` / `${VAR:-default}`
// expand (docs.claude.com/en/docs/claude-code/mcp). The file holds much else.
export const claudeCodeMcpFormat: ForeignMcpFormat = {
  serversKey: "mcpServers",
  topLevelKeys: new Set(),
  typeAliases: {},
  entryKeys: new Set(["type", "command", "args", "env", "url", "headers"]),
  rewrite: rewriteEnvVariables,
  quietTopLevel: true,
};

// Cursor, `~/.cursor/mcp.json` and `<project>/.cursor/mcp.json`: `mcpServers` with `command`,
// `args`, `env`, or `url` and `headers`; `envFile` is a stdio option Pica lacks
// (docs.cursor.com/context/model-context-protocol).
export function cursorMcpFormat(context: CursorVariableContext): ForeignMcpFormat {
  return {
    serversKey: "mcpServers",
    topLevelKeys: new Set(),
    typeAliases: { streamableHttp: "http", "streamable-http": "http" },
    entryKeys: new Set(["type", "command", "args", "env", "url", "headers"]),
    rewrite: (text) => rewriteCursorVariables(text, context),
  };
}

// Windsurf, `~/.codeium/windsurf/mcp_config.json`: `mcpServers`; a remote server's URL is
// `serverUrl` (`url` is also read); `disabled` and `disabledTools` have no Pica equivalent
// (docs.windsurf.com/windsurf/cascade/mcp).
export const windsurfMcpFormat: ForeignMcpFormat = {
  serversKey: "mcpServers",
  topLevelKeys: new Set(),
  typeAliases: { streamableHttp: "http", "streamable-http": "http" },
  entryKeys: new Set(["type", "command", "args", "env", "url", "headers"]),
  rewrite: rewriteWindsurfVariables,
  normalize: (raw, keyPath, note) => renameUrl(raw, "serverUrl", keyPath, note),
};

// VS Code user settings, `~/Library/Application Support/Code/User/mcp.json`: the same shape as
// `.vscode/mcp.json` (code.visualstudio.com/docs/copilot/customization/mcp-servers), without a
// workspace folder.
export function vscodeUserMcpFormat(home: string | undefined): ForeignMcpFormat {
  return vscodeMcpFormat(home === undefined ? {} : { home });
}

// Gemini CLI, `~/.gemini/settings.json` and `<project>/.gemini/settings.json`: `mcpServers` with
// `command`/`args`/`env`/`cwd`, `url` for SSE, `httpUrl` for streamable HTTP, `headers`, and
// `includeTools` (an allowlist); `excludeTools`, `timeout`, `trust` and OAuth settings have no Pica
// equivalent (github.com/google-gemini/gemini-cli, docs/tools/mcp-server.md). The file holds much else.
export const geminiCliMcpFormat: ForeignMcpFormat = {
  serversKey: "mcpServers",
  topLevelKeys: new Set(),
  typeAliases: {},
  entryKeys: new Set(["type", "command", "args", "env", "cwd", "url", "headers", "tools"]),
  rewrite: rewriteShellVariables,
  quietTopLevel: true,
  normalize: (raw, keyPath, note) => {
    const { httpUrl, url, includeTools, ...rest } = raw;
    const entry: Record<string, unknown> = { ...rest };
    if (httpUrl !== undefined) {
      entry["url"] = httpUrl;
      entry["type"] ??= "http";
      if (url !== undefined) {
        note(`${keyPath}.url`, "ignored: httpUrl is set, and Gemini CLI prefers it");
      }
    } else if (url !== undefined) {
      entry["url"] = url;
      entry["type"] ??= "sse";
    }
    if (includeTools !== undefined) {
      entry["tools"] = includeTools;
    }
    return entry;
  },
};

// A pasted snippet: any of the shapes above. Fields are read under every name the platforms use.
export const pastedMcpFormat = (serversKey: string): ForeignMcpFormat => ({
  serversKey,
  topLevelKeys: new Set(serversKey === "servers" ? ["inputs"] : []),
  typeAliases: { local: "stdio", streamableHttp: "http", "streamable-http": "http" },
  entryKeys: new Set(["type", "command", "args", "env", "cwd", "url", "headers", "tools"]),
  rewrite: rewriteAnyVariables,
  normalize: (raw, keyPath, note) => {
    const renamed = renameUrl(renameUrl(raw, "serverUrl", keyPath, note), "httpUrl", keyPath, note);
    if (raw["httpUrl"] !== undefined) {
      renamed["type"] ??= "http";
    }
    return renamed;
  },
});

function renameUrl(
  raw: Readonly<Record<string, unknown>>,
  key: string,
  keyPath: string,
  note: NoteSink,
): Record<string, unknown> {
  const { [key]: alias, ...rest } = raw;
  if (alias === undefined) {
    return { ...rest };
  }
  if (rest["url"] !== undefined) {
    note(`${keyPath}.${key}`, "ignored: url is also set");
    return { ...rest };
  }
  return { ...rest, url: alias };
}
