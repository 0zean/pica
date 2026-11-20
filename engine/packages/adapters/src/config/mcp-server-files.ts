import { applyEdits, modify } from "jsonc-parser";
import { configError, err, ok } from "@pica/core";
import type { ConfigError, McpServerFiles, Result } from "@pica/core";
import { jsoncFormatting } from "./config-file-edit.ts";
import { parseConfigFile } from "./jsonc.ts";
import { mcpTargetFile, readMcpTargetText, writeMcpTargetText } from "./mcp-import-files.ts";

// A-13: `mcp.add`, `mcp.update` and `mcp.remove` edit Pica's own `mcp.jsonc` in place.
export function createMcpServerFiles(homeDir: string): McpServerFiles {
  const read = (file: string): Result<{ readonly text: string; readonly ids: readonly string[] }, ConfigError> => {
    const text = readMcpTargetText(file);
    if (!text.ok) {
      return text;
    }
    if (text.value === undefined) {
      return ok({ text: "{}\n", ids: [] });
    }
    const parsed = parseConfigFile(file, text.value);
    if (!parsed.ok) {
      return parsed;
    }
    return ok({ text: text.value, ids: serverIds(parsed.value.value) });
  };

  return {
    path: (target) => mcpTargetFile(homeDir, target),
    ids(target) {
      const file = mcpTargetFile(homeDir, target);
      if (!file.ok) {
        return file;
      }
      const current = read(file.value);
      return current.ok ? ok(current.value.ids) : current;
    },
    write(target, id, entry) {
      const file = mcpTargetFile(homeDir, target);
      if (!file.ok) {
        return file;
      }
      const current = read(file.value);
      if (!current.ok) {
        return current;
      }
      if (entry === undefined && !current.value.ids.includes(id)) {
        return err(configError("config.invalid", file.value, [{ keyPath: `servers.${id}`, message: "no such server" }]));
      }
      const edits = modify(current.value.text, ["servers", id], entry, jsoncFormatting);
      return writeMcpTargetText(file.value, applyEdits(current.value.text, edits));
    },
  };
}

function serverIds(value: unknown): string[] {
  if (typeof value !== "object" || value === null || !("servers" in value)) {
    return [];
  }
  const servers = value.servers;
  return typeof servers === "object" && servers !== null ? Object.keys(servers) : [];
}
