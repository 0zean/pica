import type { SessionEvent } from "@pica/protocol";
import type { EventLog, EventLogError } from "./log.ts";
import { initialNormalizerState, normalizeRuntimeEvent } from "./normalize.ts";
import type { IncomingRuntimeEvent, NormalizerContext, NormalizerState } from "./normalize.ts";

export interface RecordOutcome {
  readonly appended: readonly SessionEvent[];
  readonly errors: readonly EventLogError[];
}

export interface RuntimeEventRecorder {
  // Never throws. A failed append is reported and the recorder carries on with the next event.
  record(event: IncomingRuntimeEvent): RecordOutcome;
}

// Normalizes one session's runtime events in arrival order and appends them to the log.
export function createRuntimeEventRecorder(log: EventLog, context: NormalizerContext): RuntimeEventRecorder {
  let state: NormalizerState = initialNormalizerState;
  return {
    record: (event) => {
      const normalized = normalizeRuntimeEvent(state, event, context);
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
    },
  };
}
