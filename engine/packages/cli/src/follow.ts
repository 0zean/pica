import type { SessionEvent, SessionState } from "@pica/protocol";
import type * as z from "zod";
import type { EngineConnection, Result } from "./client.ts";

type State = z.output<typeof SessionState>;

// Where a command stops reading a session's events.
export type Until =
  // Replay through this sequence number.
  | { readonly kind: "seq"; readonly seq: number }
  // Read until an event after `afterSeq` matches.
  | { readonly kind: "event"; readonly afterSeq: number; readonly matches: (event: SessionEvent) => boolean };

export interface Followed {
  readonly lastState: State | undefined;
  readonly errors: readonly { readonly code: string; readonly message: string }[];
}

const settledStates: readonly State[] = ["idle", "resumable", "ended", "failed"];
const turnStates: readonly State[] = ["running", "awaiting_approval"];

export function isTurnEnd(event: SessionEvent): boolean {
  if (event.type !== "session.state_changed") {
    return false;
  }
  const { from, to } = event.payload;
  return isSessionEnd(event) || (from !== null && turnStates.includes(from) && settledStates.includes(to));
}

export function isSessionEnd(event: SessionEvent): boolean {
  return event.type === "session.state_changed" && (event.payload.to === "ended" || event.payload.to === "failed");
}

export function isBusy(state: State): boolean {
  return state === "starting" || turnStates.includes(state);
}

function reached(until: Until, event: SessionEvent): boolean {
  return until.kind === "seq" ? event.seq >= until.seq : event.seq > until.afterSeq && until.matches(event);
}

// Subscribes after `afterSeq`, runs `afterSubscribe` (which may start the turn being watched and
// decides where to stop), and passes each event to `print` until then.
export async function follow(
  connection: EngineConnection,
  sessionId: string,
  afterSeq: number,
  print: (event: SessionEvent) => void,
  afterSubscribe: (subscribed: Result<"events.subscribe">) => Promise<Until>,
): Promise<Followed> {
  const errors: { code: string; message: string }[] = [];
  let lastState: State | undefined;
  let until: Until | undefined;
  const held: SessionEvent[] = [];
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let done = false;

  const handle = (event: SessionEvent): void => {
    if (done || until === undefined) {
      return;
    }
    print(event);
    if (event.type === "session.error") {
      errors.push({ code: event.payload.code, message: event.payload.message });
    }
    if (event.type === "session.state_changed") {
      lastState = event.payload.to;
    }
    if (reached(until, event)) {
      done = true;
      finish();
    }
  };

  const subscribed = await connection.subscribe(sessionId, afterSeq, {
    onEvent: (event) => {
      if (until === undefined) {
        held.push(event);
      } else {
        handle(event);
      }
    },
  });
  try {
    until = await afterSubscribe(subscribed);
    if (until.kind === "seq" && until.seq <= afterSeq) {
      done = true;
      finish();
    }
    for (const event of held.splice(0)) {
      handle(event);
    }
    await Promise.race([
      finished,
      connection.lost.then((error) => {
        throw error;
      }),
    ]);
  } finally {
    await connection.unsubscribe(subscribed.subscriptionId).catch(() => undefined);
  }
  return { lastState, errors };
}
