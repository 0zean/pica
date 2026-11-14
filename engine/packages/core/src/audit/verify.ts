import type { JsonObject, JsonValue } from "../json.ts";
import { err, ok } from "../result.ts";
import { emptyHead, entryLine, sealEntry } from "./chain.ts";
import type { AuditHead } from "./chain.ts";
import type { AuditEntry, AuditHash, AuditKind, AuditResult } from "./types.ts";

const auditKinds: readonly AuditKind[] = [
  "tool.started",
  "tool.completed",
  "tool.failed",
  "policy.decision",
  "approval.requested",
  "approval.resolved",
];

export interface AuditVerification {
  readonly entries: number;
  readonly head: AuditHead;
}

/**
 * Checks every line in order: it must be the canonical text of an entry whose `seq` follows the
 * previous one, whose `prevHash` is the previous line's hash, and whose `hash` matches its content.
 * The first line that fails is reported, so an edit, insertion, deletion, or reorder fails there.
 */
export function verifyAuditLines(lines: readonly string[], hash: AuditHash): AuditResult<AuditVerification> {
  let head = emptyHead;
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const entry = parseEntry(line);
    if (entry === undefined || entryLine(entry) !== line) {
      return broken(lineNumber, "is not a well-formed audit entry");
    }
    if (entry.seq !== head.seq + 1) {
      return broken(lineNumber, `has seq ${String(entry.seq)} where ${String(head.seq + 1)} was expected`);
    }
    if (entry.prevHash !== head.hash) {
      return broken(lineNumber, "does not follow the previous line's hash");
    }
    if (sealEntry(head, entry, hash).hash !== entry.hash) {
      return broken(lineNumber, "does not match its hash");
    }
    head = { seq: entry.seq, hash: entry.hash };
  }
  return ok({ entries: lines.length, head });
}

function broken(line: number, why: string): AuditResult<never> {
  return err({ code: "audit.chain_broken", line, message: `audit log line ${String(line)} ${why}` });
}

function parseEntry(line: string): AuditEntry | undefined {
  const value = parseJson(line);
  if (!isObject(value)) {
    return undefined;
  }
  const { seq, eventSeq, timestamp, sessionId, kind, data, prevHash, hash } = value;
  if (
    !isCount(seq) ||
    !isCount(eventSeq) ||
    typeof timestamp !== "string" ||
    typeof sessionId !== "string" ||
    !isAuditKind(kind) ||
    !isObject(data) ||
    typeof prevHash !== "string" ||
    typeof hash !== "string"
  ) {
    return undefined;
  }
  return { seq, eventSeq, timestamp, sessionId, kind, data, prevHash, hash };
}

function parseJson(line: string): JsonValue | undefined {
  try {
    return JSON.parse(line) as JsonValue;
  } catch {
    return undefined;
  }
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAuditKind(value: JsonValue | undefined): value is AuditKind {
  return auditKinds.some((kind) => kind === value);
}
