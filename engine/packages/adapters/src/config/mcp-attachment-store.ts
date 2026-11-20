import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { err, ok } from "@pica/core";
import type { McpAttachmentState, McpAttachmentStore } from "@pica/core";
import { McpAttachmentsFile } from "@pica/protocol";

export function mcpAttachmentsPath(dataDir: string): string {
  return join(dataDir, "mcp-attachments.json");
}

// A-13: which servers are attached to which workspace and session. Engine state, not user config,
// so it sits beside the store rather than in `mcp.jsonc`.
export function createJsonMcpAttachmentStore(file: string): McpAttachmentStore {
  return {
    read() {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch (thrown) {
        if (isMissing(thrown)) {
          return ok({ workspaces: {}, sessions: {} });
        }
        return err({ message: errorMessage(thrown) });
      }
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (thrown) {
        return err({ message: `${file} is not JSON: ${errorMessage(thrown)}` });
      }
      const parsed = McpAttachmentsFile.safeParse(value);
      return parsed.success ? ok(parsed.data) : err({ message: `${file} is malformed: ${parsed.error.issues[0]?.message ?? ""}` });
    },
    write(state: McpAttachmentState) {
      try {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${String(process.pid)}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        renameSync(temporary, file);
      } catch (thrown) {
        return err({ message: errorMessage(thrown) });
      }
      return ok(undefined);
    },
  };
}

function isMissing(thrown: unknown): boolean {
  return typeof thrown === "object" && thrown !== null && "code" in thrown && thrown.code === "ENOENT";
}

function errorMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
