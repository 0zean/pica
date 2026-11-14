import type { JsonObject } from "../json.ts";
import type { Result } from "../result.ts";

export type AuditKind =
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "policy.decision"
  | "approval.requested"
  | "approval.resolved";

/** What is audited about one session event; never tool arguments, results, or error text. */
export interface AuditRecord {
  readonly sessionId: string;
  readonly eventSeq: number;
  readonly timestamp: string;
  readonly kind: AuditKind;
  readonly data: JsonObject;
}

/** One line of the audit log. `hash` covers every other field, `prevHash` included. */
export interface AuditEntry extends AuditRecord {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

/** SHA-256 of the UTF-8 text, as lowercase hex. Hashing is I/O-free but lives in an adapter (D-07). */
export type AuditHash = (text: string) => string;

export type AuditErrorCode = "audit.chain_broken" | "audit.read_failed" | "audit.write_failed";

export interface AuditError {
  readonly code: AuditErrorCode;
  readonly message: string;
  /** 1-based line of the log at which verification failed. */
  readonly line?: number;
}

export type AuditResult<T> = Result<T, AuditError>;

/** Append-only storage for audit lines; each line is written whole or not at all. */
export interface AuditStore {
  readLines(): AuditResult<readonly string[]>;
  appendLine(line: string): AuditResult<void>;
}
