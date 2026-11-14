import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { err, ok, type SessionArtifacts } from "@pica/core";

// Artifacts live at <root>/<sessionId>/artifacts/<name>. Each path segment is reduced to a safe
// file name so an id or name can never escape the session's directory.
export function createSessionArtifacts(root: string): SessionArtifacts {
  return {
    async write(sessionId, name, content) {
      const path = join(resolve(root), safeSegment(sessionId), "artifacts", ...name.split("/").map(safeSegment));
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf8");
        return ok({ path });
      } catch (thrown) {
        return err({ code: "artifact.write_failed", message: thrown instanceof Error ? thrown.message : String(thrown) });
      }
    },
  };
}

function safeSegment(segment: string): string {
  const safe = segment.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe === "" || /^\.+$/.test(safe) ? "_" : safe;
}
