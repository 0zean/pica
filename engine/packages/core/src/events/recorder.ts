import type { SessionEvent } from "@pica/protocol";
import type { EventLog, EventLogError } from "./log.ts";
import { initialNormalizerState, interruptOpen, normalizeRuntimeEvent } from "./normalize.ts";
import type { IncomingRuntimeEvent, Normalized, NormalizerContext, NormalizerState } from "./normalize.ts";

export interface RecordOutcome {
  readonly appended: readonly SessionEvent[];
  readonly errors: readonly EventLogError[];
}

export interface RuntimeEventRecorder {
  // Never throws. A failed append is reported and the recorder carries on with the next event.
  record(event: IncomingRuntimeEvent): RecordOutcome;
  // Closes the turn's open tool calls and sub-agents as failed, for an abort the caller records itself.
  interrupt(timestamp: string): RecordOutcome;
}

// Normalizes one session's runtime events in arrival order and appends them to the log.
export function createRuntimeEventRecorder(log: EventLog, context: NormalizerContext): RuntimeEventRecorder {
  let state: NormalizerState = initialNormalizerState;
  const apply = (normalized: Normalized): RecordOutcome => {
    state = normalized.state;
    const appended: SessionEvent[] = [];
    const errors: EventLogError[] = [];
    for (const draft of normalized.drafts) {
      const result = log.append(context.sessionId, draft);
      if (result.ok) {
        appended.push(result.value);
      } else {
        errors.push(result.error);
      }
    }
    return { appended, errors };
  };
  return {
    record: (event) => apply(normalizeRuntimeEvent(state, event, context)),
    interrupt: (timestamp) => apply(interruptOpen(state, timestamp)),
  };
}
