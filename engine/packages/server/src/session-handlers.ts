import { randomUUID } from "node:crypto";
import { protocolErrorCode } from "@pica/core";
import type { EventLog, EventRepository, SessionInfo, SessionResult, SessionService, SessionServiceError } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { ErrorCodeName } from "./errors.ts";
import type { MethodResult, MethodRouter } from "./router.ts";

export interface SessionHandlerDeps {
  readonly sessions: SessionService;
  readonly log: EventLog;
  readonly events: Pick<EventRepository, "lastSeq">;
  readonly newSubscriptionId?: () => string;
}

const serviceCodes: Readonly<Record<SessionServiceError["code"], ErrorCodeName>> = {
  "session.not_found": "not_found",
  "session.invalid_state": "invalid_state",
  "session.invalid_request": "invalid_params",
  "session.approval_not_found": "not_found",
  "session.runtime_failed": "runtime_failed",
  "session.store_failed": "internal_error",
};

export function sessionRpcFailure(error: SessionServiceError): RpcFailure {
  const code = error.runtimeCode === undefined ? serviceCodes[error.code] : protocolErrorCode(error.runtimeCode);
  return new RpcFailure(code, error.message, {
    reason: error.code,
    ...(error.runtimeCode === undefined ? {} : { runtimeCode: error.runtimeCode }),
  });
}

function unwrap<T>(result: SessionResult<T>): T {
  if (!result.ok) {
    throw sessionRpcFailure(result.error);
  }
  return result.value;
}

const done = { ok: true } as const;

export function toSessionDto(session: SessionInfo): MethodResult<"session.get">["session"] {
  return { ...session, writeRoots: [...session.writeRoots], referenceRoots: [...session.referenceRoots] };
}

export function registerSessionHandlers(router: MethodRouter, deps: SessionHandlerDeps): void {
  const { sessions } = deps;
  router.register("session.create", async (params) => ({ session: toSessionDto(unwrap(await sessions.create(params))) }));
  router.register("session.list", ({ workspaceId }) => ({ sessions: unwrap(sessions.list(workspaceId)).map(toSessionDto) }));
  router.register("session.get", ({ sessionId }) => ({ session: toSessionDto(unwrap(sessions.get(sessionId))) }));
  router.register("session.send", async ({ sessionId, text, mode }) => unwrap(await sessions.send(sessionId, text, mode)));
  router.register("session.abort", async ({ sessionId }) => {
    unwrap(await sessions.abort(sessionId));
    return done;
  });
  router.register("session.resume", async ({ sessionId }) => ({ session: toSessionDto(unwrap(await sessions.resume(sessionId))) }));
  router.register("session.end", async ({ sessionId }) => {
    unwrap(await sessions.end(sessionId));
    return done;
  });
  router.register("approval.list", ({ sessionId }) => ({ approvals: [...unwrap(sessions.listApprovals(sessionId))] }));
  router.register("approval.resolve", async ({ approvalId, choice }) => {
    unwrap(await sessions.resolveApproval(approvalId, choice));
    return done;
  });
  registerEventHandlers(router, deps);
}

function registerEventHandlers(router: MethodRouter, deps: SessionHandlerDeps): void {
  const newId = deps.newSubscriptionId ?? randomUUID;
  const open = new Map<string, { readonly connectionId: number; close: () => void }>();

  router.register("events.subscribe", ({ sessionId, afterSeq }, context) => {
    unwrap(deps.sessions.get(sessionId));
    const lastSeq = deps.events.lastSeq(sessionId);
    if (!lastSeq.ok) {
      throw new RpcFailure("internal_error", lastSeq.error.message);
    }
    const subscriptionId = newId();
    const entry: { readonly connectionId: number; close: () => void } = {
      connectionId: context.connectionId,
      close: () => undefined,
    };
    open.set(subscriptionId, entry);
    context.onClose(() => {
      entry.close();
      open.delete(subscriptionId);
    });
    // Replay starts after the response is written, so the client knows the id its events carry.
    setImmediate(() => {
      if (!open.has(subscriptionId)) {
        return;
      }
      const subscription = deps.log.subscribe(sessionId, afterSeq, {
        onEvent: (event) => {
          context.notify("events.event", { subscriptionId, event });
        },
      });
      entry.close = () => {
        subscription.close();
      };
    });
    return { subscriptionId, lastSeq: lastSeq.value };
  });

  router.register("events.unsubscribe", ({ subscriptionId }, context) => {
    const entry = open.get(subscriptionId);
    if (entry === undefined || entry.connectionId !== context.connectionId) {
      throw new RpcFailure("not_found", `No subscription ${subscriptionId} on this connection.`);
    }
    entry.close();
    open.delete(subscriptionId);
    return done;
  });
}
