import type { Result, RuntimeError, RuntimeEvent, RuntimeSession } from "@pica/core";

export interface RecordedTurn {
  readonly messageId: string;
  readonly events: readonly RuntimeEvent[];
}

// Sends `prompt` and collects every event up to and including the turn's `session.idle`.
// `onEvent` sees each event as it arrives, so a test can answer a permission or abort mid-turn.
export async function recordTurn(
  session: RuntimeSession,
  prompt: string,
  onEvent: (event: RuntimeEvent) => void = () => undefined,
): Promise<Result<RecordedTurn, RuntimeError>> {
  const events: RuntimeEvent[] = [];
  let finish = (): void => undefined;
  const idle = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    onEvent(event);
    if (event.type === "session.idle") {
      finish();
    }
  });
  const sent = await session.send(prompt);
  if (!sent.ok) {
    unsubscribe();
    return sent;
  }
  await idle;
  unsubscribe();
  return { ok: true, value: { messageId: sent.value.messageId, events } };
}
