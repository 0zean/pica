import type { SessionEvent } from "@pica/protocol";
import type { Command, UsageGrouping } from "./args.ts";
import type { EngineConnection } from "./client.ts";
import { EngineError, SessionFailure } from "./errors.ts";
import { follow, isBusy, isSessionEnd, isTurnEnd } from "./follow.ts";
import type { Followed, Until } from "./follow.ts";
import { renderEvent, renderSessions, renderUsage } from "./render.ts";
import type { UsageRow } from "./render.ts";

export interface Output {
  readonly json: boolean;
  readonly write: (line: string) => void;
}

type EngineCommand = Exclude<Command, { kind: "help" }>;

export async function runCommand(command: EngineCommand, connection: EngineConnection, out: Output): Promise<void> {
  switch (command.kind) {
    case "session.new":
      return sessionNew(command, connection, out);
    case "session.send":
      return sessionSend(command, connection, out);
    case "session.attach":
      return sessionAttach(command, connection, out);
    case "session.list":
      return sessionList(command, connection, out);
    case "usage":
      return usage(command, connection, out);
  }
}

// Engine errors that describe the session's own failure rather than the engine's.
const sessionErrorCodes: ReadonlySet<string> = new Set([
  "invalid_state",
  "runtime_failed",
  "quota_exhausted",
  "model_unavailable",
  "budget_exhausted",
  "policy_denied",
  "auth_required",
  "auth_sso_required",
  "auth_scope_missing",
]);

async function asSessionCall<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof EngineError && sessionErrorCodes.has(error.code)) {
      throw new SessionFailure(error.code, error.message);
    }
    throw error;
  }
}

function printer(out: Output): (event: SessionEvent) => void {
  return (event) => {
    if (out.json) {
      out.write(JSON.stringify({ event }));
      return;
    }
    const line = renderEvent(event);
    if (line !== undefined) {
      out.write(line);
    }
  };
}

function checkOutcome(sessionId: string, followed: Followed): void {
  const last = followed.errors.at(-1);
  if (last !== undefined) {
    throw new SessionFailure(last.code, `Session ${sessionId}: ${last.message}`);
  }
  if (followed.lastState === "failed") {
    throw new SessionFailure("session_failed", `Session ${sessionId} failed.`);
  }
}

async function sessionNew(
  command: Extract<Command, { kind: "session.new" }>,
  connection: EngineConnection,
  out: Output,
): Promise<void> {
  const { session } = await asSessionCall(
    connection.request("session.create", {
      workspaceId: command.workspaceId,
      writeRepoIds: [...command.writeRepoIds],
      referenceRepoIds: [...command.referenceRepoIds],
      ...(command.routingProfile === undefined ? {} : { routingProfile: command.routingProfile }),
      ...(command.budgetCredits === undefined ? {} : { budgetCredits: command.budgetCredits }),
      ...(command.prompt === undefined ? {} : { prompt: command.prompt }),
    }),
  );
  out.write(out.json ? JSON.stringify({ session }) : `Session ${session.id}`);
  if (command.prompt === undefined) {
    return;
  }
  const followed = await follow(connection, session.id, 0, printer(out), () =>
    Promise.resolve({ kind: "event", afterSeq: 0, matches: isTurnEnd }),
  );
  checkOutcome(session.id, followed);
}

async function sessionSend(
  command: Extract<Command, { kind: "session.send" }>,
  connection: EngineConnection,
  out: Output,
): Promise<void> {
  const { session } = await connection.request("session.get", { sessionId: command.sessionId });
  const sendIt = async (): Promise<boolean> => {
    const { accepted } = await asSessionCall(
      connection.request("session.send", { sessionId: command.sessionId, text: command.text, mode: command.mode }),
    );
    if (!accepted) {
      throw new SessionFailure("not_accepted", `Session ${command.sessionId} is busy; send with --mode queue or steer.`);
    }
    return accepted;
  };
  // A queued or steering message does not start a turn of its own right away; `attach` shows it.
  if (command.mode !== "send") {
    await sendIt();
    out.write(out.json ? JSON.stringify({ accepted: true }) : `Accepted (${command.mode}).`);
    return;
  }
  const followed = await follow(connection, session.id, session.lastSeq, printer(out), async () => {
    await sendIt();
    return { kind: "event", afterSeq: session.lastSeq, matches: isTurnEnd };
  });
  checkOutcome(session.id, followed);
}

async function sessionAttach(
  command: Extract<Command, { kind: "session.attach" }>,
  connection: EngineConnection,
  out: Output,
): Promise<void> {
  const followed = await follow(connection, command.sessionId, command.afterSeq, printer(out), async (): Promise<Until> => {
    const { session } = await connection.request("session.get", { sessionId: command.sessionId });
    if (command.follow && session.state !== "ended" && session.state !== "failed") {
      return { kind: "event", afterSeq: session.lastSeq, matches: isSessionEnd };
    }
    if (!command.follow && isBusy(session.state)) {
      return { kind: "event", afterSeq: session.lastSeq, matches: isTurnEnd };
    }
    return { kind: "seq", seq: session.lastSeq };
  });
  if (followed.lastState === "failed") {
    throw new SessionFailure("session_failed", `Session ${command.sessionId} failed.`);
  }
}

async function sessionList(
  command: Extract<Command, { kind: "session.list" }>,
  connection: EngineConnection,
  out: Output,
): Promise<void> {
  const result = await connection.request(
    "session.list",
    command.workspaceId === undefined ? {} : { workspaceId: command.workspaceId },
  );
  out.write(out.json ? JSON.stringify({ sessions: result.sessions }) : renderSessions(result.sessions));
}

// Totals come from each session's `usage.recorded` events until the engine serves `usage.rollup`.
async function usage(command: Extract<Command, { kind: "usage" }>, connection: EngineConnection, out: Output): Promise<void> {
  const sessions =
    command.sessionId === undefined
      ? (await connection.request("session.list", command.workspaceId === undefined ? {} : { workspaceId: command.workspaceId }))
          .sessions
      : [(await connection.request("session.get", { sessionId: command.sessionId })).session];
  const totals = new Map<string, UsageRow>();
  for (const session of sessions) {
    await follow(
      connection,
      session.id,
      0,
      (event) => {
        if (event.type === "usage.recorded") {
          add(totals, usageKey(command.groupBy, event.payload), event.payload);
        }
      },
      (subscribed) => Promise.resolve({ kind: "seq", seq: subscribed.lastSeq }),
    );
  }
  const rows = [...totals.values()].sort((a, b) => a.key.localeCompare(b.key));
  out.write(out.json ? JSON.stringify({ groupBy: command.groupBy, rows }) : renderUsage(command.groupBy, rows));
}

type UsageRecord = Extract<SessionEvent, { type: "usage.recorded" }>["payload"];

function usageKey(groupBy: UsageGrouping, record: UsageRecord): string {
  switch (groupBy) {
    case "session":
      return record.sessionId;
    case "model":
      return record.model;
    case "agent":
      return record.agent;
  }
}

function add(totals: Map<string, UsageRow>, key: string, record: UsageRecord): void {
  const row = totals.get(key) ?? { key, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, credits: 0 };
  totals.set(key, {
    key,
    inputTokens: row.inputTokens + record.inputTokens,
    cachedInputTokens: row.cachedInputTokens + record.cachedInputTokens,
    outputTokens: row.outputTokens + record.outputTokens,
    credits: row.credits + record.credits,
  });
}
