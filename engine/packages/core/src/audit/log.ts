import type { EventLog } from "../events/index.ts";
import type { PolicyDecision } from "../policy/index.ts";
import { ok } from "../result.ts";
import { entryLine, sealEntry } from "./chain.ts";
import { auditRecordOf, policyDecisionEvent } from "./records.ts";
import type { AuditEntry, AuditError, AuditHash, AuditRecord, AuditResult, AuditStore } from "./types.ts";
import { verifyAuditLines } from "./verify.ts";

export interface AuditLog {
  record(record: AuditRecord): AuditResult<AuditEntry>;
}

export interface AuditLogDeps {
  readonly store: AuditStore;
  readonly hash: AuditHash;
}

/** Continues the chain from the stored log, which must verify; a broken log is never appended to. */
export function openAuditLog(deps: AuditLogDeps): AuditResult<AuditLog> {
  const lines = deps.store.readLines();
  if (!lines.ok) {
    return lines;
  }
  const verified = verifyAuditLines(lines.value, deps.hash);
  if (!verified.ok) {
    return verified;
  }
  let head = verified.value.head;
  return ok({
    record: (record) => {
      const entry = sealEntry(head, record, deps.hash);
      const appended = deps.store.appendLine(entryLine(entry));
      if (!appended.ok) {
        return appended;
      }
      head = { seq: entry.seq, hash: entry.hash };
      return ok(entry);
    },
  });
}

/** Writes an audit entry for every audited event the wrapped log stores, in the order stored. */
export function withAuditLog(log: EventLog, audit: AuditLog, onError: (error: AuditError) => void): EventLog {
  return {
    subscribe: (sessionId, afterSeq, listener) => log.subscribe(sessionId, afterSeq, listener),
    append: (sessionId, draft) => {
      const appended = log.append(sessionId, draft);
      const record = appended.ok ? auditRecordOf(appended.value) : undefined;
      if (record !== undefined) {
        const written = audit.record(record);
        if (!written.ok) {
          onError(written.error);
        }
      }
      return appended;
    },
  };
}

export type PolicyDecisionSink = (sessionId: string, decision: PolicyDecision) => void;

/** Emits each decision as a `policy.decision` event; through `withAuditLog` it is audited too. */
export function emitPolicyDecisions(log: Pick<EventLog, "append">, clock: () => string): PolicyDecisionSink {
  return (sessionId, decision) => {
    log.append(sessionId, policyDecisionEvent(decision, clock()));
  };
}
