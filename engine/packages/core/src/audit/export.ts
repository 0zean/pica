import { ok } from "../result.ts";
import type { AuditHead } from "./chain.ts";
import type { AuditHash, AuditResult, AuditStore } from "./types.ts";
import { verifyAuditLines } from "./verify.ts";

export interface AuditExport {
  /** The whole log as JSONL, one entry per line, ending with a newline. */
  readonly content: string;
  readonly entries: number;
  /** Publishing the head hash out of band lets a recipient detect a truncated or rewritten copy. */
  readonly head: AuditHead;
}

// The whole chain is exported: a filtered subset could not be verified on its own.
export function exportAuditLog(store: Pick<AuditStore, "readLines">, hash: AuditHash): AuditResult<AuditExport> {
  const lines = store.readLines();
  if (!lines.ok) {
    return lines;
  }
  const verified = verifyAuditLines(lines.value, hash);
  if (!verified.ok) {
    return verified;
  }
  const content = lines.value.map((line) => `${line}\n`).join("");
  return ok({ content, entries: verified.value.entries, head: verified.value.head });
}
