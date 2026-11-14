# Audit log (H-02)

The engine keeps an append-only JSONL record of tool calls, approvals and policy decisions, so an
administrator can show what agents did and detect that the record was edited.

## What is recorded

One line per session event of these types, in the order the event log stored them:

| `kind` | `data` |
|---|---|
| `tool.started`, `tool.failed` | `toolCallId`, `toolName`, `agent`, `parentToolCallId` |
| `tool.completed` | the same, plus `resultBytes` |
| `policy.decision` | `ruleId`, `ruleGroup`, `outcome`, `reason`, `toolCallId`, `toolName`, `agent` |
| `approval.requested` | `approvalId`, `approvalKind`, `toolCallId` |
| `approval.resolved` | `approvalId`, `choice` |

Tool arguments, results, error text and approval summaries are never written: they can carry file
contents or secrets, and the log is meant to leave the machine. Each line also carries `sessionId`,
`eventSeq` (the event's `seq` in its session log) and `timestamp`.

Policy decisions reach the log as `policy.decision` events: the read gate (C-04) and the output guard
(C-06) report each decision through `onDecision`, `emitPolicyDecisions` appends it to the event log,
and `withAuditLog` writes an audit line for every audited event the event log stores.

## Hash chain

Each line is the canonical JSON (keys sorted, no whitespace) of an entry with `seq` (1, 2, …),
`prevHash` (the previous line's `hash`; 64 zeros for the first line) and `hash`, the SHA-256 of the
canonical JSON of every other field. `verifyAuditLines` checks, line by line, that the text is
canonical, that `seq` and `prevHash` continue the chain and that `hash` matches; it reports the first
line that fails. An edited, inserted, deleted, truncated or reordered line therefore fails at its own
position.

The chain is not keyed. Someone who can write the file can recompute the hash of an edited line and
of every line after it. Such a rewrite is detected only against a head hash kept elsewhere:
`exportAuditFile` verifies the log, copies it, and returns the entry count and head hash to publish
alongside the copy.

The engine refuses to continue a log that does not verify (`audit.chain_broken`). A crash during an
append can leave a partial last line, which verification reports at that line.
