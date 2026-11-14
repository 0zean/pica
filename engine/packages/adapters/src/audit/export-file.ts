import { writeFileSync } from "node:fs";
import { err, exportAuditLog, ok } from "@pica/core";
import type { AuditExport, AuditResult } from "@pica/core";
import { createJsonlAuditStore } from "./jsonl-audit-store.ts";
import { sha256Hex } from "./sha256.ts";

/** Verifies the log at `source` and writes it to `destination`; a broken log is not exported. */
export function exportAuditFile(source: string, destination: string): AuditResult<Omit<AuditExport, "content">> {
  const exported = exportAuditLog(createJsonlAuditStore(source), sha256Hex);
  if (!exported.ok) {
    return exported;
  }
  const { content, entries, head } = exported.value;
  try {
    writeFileSync(destination, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (thrown) {
    return err({ code: "audit.write_failed", message: thrown instanceof Error ? thrown.message : String(thrown) });
  }
  return ok({ entries, head });
}
