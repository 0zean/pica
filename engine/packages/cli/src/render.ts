import type { SessionEvent } from "@pica/protocol";
import type { Result } from "./client.ts";

type SessionDto = Result<"session.get">["session"];
export type UsageRow = Result<"usage.rollup">["rows"][number];

// One line per event, or none for events that only matter to a live UI (deltas, context size).
export function renderEvent(event: SessionEvent): string | undefined {
  switch (event.type) {
    case "session.state_changed":
      return `· ${event.payload.from ?? "new"} → ${event.payload.to}`;
    case "user.message":
      return `> ${event.payload.text}${event.payload.mode === "send" ? "" : ` (${event.payload.mode})`}`;
    case "assistant.delta":
    case "context.usage":
      return undefined;
    case "assistant.message":
      return `[${event.payload.agent}] ${event.payload.text}`;
    case "tool.started":
      return `→ ${event.payload.toolName} ${JSON.stringify(event.payload.arguments)}`;
    case "tool.completed":
      return `✓ ${event.payload.toolName} (${String(event.payload.resultBytes)} bytes)`;
    case "tool.failed":
      return `✗ ${event.payload.toolName}: ${event.payload.error}`;
    case "subagent.started":
      return `↳ ${event.payload.agent} started on ${event.payload.model}`;
    case "subagent.completed":
      return `↳ ${event.payload.agent} done: ${String(event.payload.totalTokens)} tokens`;
    case "subagent.failed":
      return `↳ ${event.payload.agent} failed: ${event.payload.error}`;
    case "policy.decision":
      return `§ ${event.payload.ruleId} ${event.payload.outcome} ${event.payload.toolName}: ${event.payload.reason}`;
    case "approval.requested":
      return `? approval ${event.payload.id}: ${event.payload.summary}`;
    case "approval.resolved":
      return `? approval ${event.payload.approvalId}: ${event.payload.choice}`;
    case "usage.recorded":
      return `$ ${event.payload.model} in ${String(event.payload.inputTokens)} cached ${String(event.payload.cachedInputTokens)} out ${String(event.payload.outputTokens)}`;
    case "budget.warning":
      return `$ budget ${String(event.payload.spentCredits)} of ${String(event.payload.limitCredits)} credits`;
    case "budget.exhausted":
      return `$ budget exhausted at ${String(event.payload.spentCredits)} credits; approval ${event.payload.approvalId}`;
    case "session.aborted":
      return `· aborted (${event.payload.reason})`;
    case "session.error":
      return `! ${event.payload.code}: ${event.payload.message}`;
    case "runtime.unknown":
      return `· unknown runtime event ${event.payload.runtimeType}`;
  }
}

export function renderSessions(sessions: readonly SessionDto[]): string {
  if (sessions.length === 0) {
    return "No sessions.";
  }
  return table(
    ["ID", "WORKSPACE", "STATE", "PROFILE", "EVENTS", "UPDATED"],
    sessions.map((session) => [
      session.id,
      session.workspaceId,
      session.state,
      session.routingProfile,
      String(session.lastSeq),
      session.updatedAt,
    ]),
  );
}

export function renderUsage(header: string, rows: readonly UsageRow[]): string {
  if (rows.length === 0) {
    return "No usage recorded.";
  }
  return table(
    [header.toUpperCase(), "INPUT", "CACHED", "OUTPUT", "CREDITS"],
    rows.map((row) => [
      row.key,
      String(row.inputTokens),
      String(row.cachedInputTokens),
      String(row.outputTokens),
      String(row.credits),
    ]),
  );
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)));
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}
