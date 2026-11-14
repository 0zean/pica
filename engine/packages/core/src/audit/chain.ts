import type { JsonObject } from "../json.ts";
import { canonicalJson } from "../mcp-attach/index.ts";
import type { AuditEntry, AuditHash, AuditRecord } from "./types.ts";

export const genesisHash = "0".repeat(64);

export interface AuditHead {
  readonly seq: number;
  readonly hash: string;
}

export const emptyHead: AuditHead = { seq: 0, hash: genesisHash };

export function sealEntry(head: AuditHead, record: AuditRecord, hash: AuditHash): AuditEntry {
  const seq = head.seq + 1;
  const { sessionId, eventSeq, timestamp, kind, data } = record;
  const sealed = hash(canonicalJson(unsealedFields(record, seq, head.hash)));
  return { seq, sessionId, eventSeq, timestamp, kind, data, prevHash: head.hash, hash: sealed };
}

// Canonical JSON (sorted keys, no whitespace) gives each entry exactly one text, so a line is
// checked byte for byte rather than only after parsing.
export function entryLine(entry: AuditEntry): string {
  return canonicalJson({ ...unsealedFields(entry, entry.seq, entry.prevHash), hash: entry.hash });
}

function unsealedFields(record: AuditRecord, seq: number, prevHash: string): JsonObject {
  const { sessionId, eventSeq, timestamp, kind, data } = record;
  return { seq, sessionId, eventSeq, timestamp, kind, data, prevHash };
}
