import { resolve } from "node:path";
import type { SessionEvent } from "@pica/protocol";
import type { Command } from "./args.ts";
import type { EngineConnection } from "./client.ts";
import { EngineError, SessionFailure } from "./errors.ts";
import { follow, isBusy, isSessionEnd, isTurnEnd } from "./follow.ts";
import type { Followed, Until } from "./follow.ts";
import { renderEvent, renderRepos, renderSessions, renderUsage, renderWorkspaces } from "./render.ts";

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
    case "workspace.create":
      return workspaceCreate(command, connection, out);
    case "workspace.list":
      return workspaceList(connection, out);
    case "repo.add":
      return repoAdd(command, connection, out);
    case "repo.list":
      return repoList(command, connection, out);
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

async function usage(command: Extract<Command, { kind: "usage" }>, connection: EngineConnection, out: Output): Promise<void> {
  const result = await connection.request("usage.rollup", {
    groupBy: command.groupBy,
    ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }),
    ...(command.workspaceId === undefined ? {} : { workspaceId: command.workspaceId }),
  });
  out.write(out.json ? JSON.stringify({ groupBy: command.groupBy, ...result }) : renderUsage(command.groupBy, result));
}

async function workspaceCreate(
  command: Extract<Command, { kind: "workspace.create" }>,
  connection: EngineConnection,
  out: Output,
): Promise<void> {
  const { workspace } = await connection.request("workspace.create", { name: command.name });
  out.write(out.json ? JSON.stringify({ workspace }) : `Workspace ${workspace.id}`);
}

async function workspaceList(connection: EngineConnection, out: Output): Promise<void> {
  const { workspaces } = await connection.request("workspace.list", {});
  out.write(out.json ? JSON.stringify({ workspaces }) : renderWorkspaces(workspaces));
}

// A relative path is taken from the directory `pica` runs in, so `pica repo add .` works.
async function repoAdd(command: Extract<Command, { kind: "repo.add" }>, connection: EngineConnection, out: Output): Promise<void> {
  const { repo } = await connection.request("repo.addPath", { path: resolve(command.path) });
  if (command.workspaceId !== undefined) {
    await connection.request("workspace.pinRepo", { workspaceId: command.workspaceId, repoId: repo.id });
  }
  out.write(out.json ? JSON.stringify({ repo }) : `Repo ${repo.id} ${repo.remoteUrl ?? repo.localPath ?? ""}`);
}

async function repoList(command: Extract<Command, { kind: "repo.list" }>, connection: EngineConnection, out: Output): Promise<void> {
  const { repos } = await connection.request("repo.list", command.workspaceId === undefined ? {} : { workspaceId: command.workspaceId });
  out.write(out.json ? JSON.stringify({ repos }) : renderRepos(repos));
}
