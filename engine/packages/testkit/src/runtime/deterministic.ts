export type Clock = () => string;
export type IdSource = (kind: string) => string;

// Each reading advances by `stepMs`, so event timestamps are strictly increasing and replayable.
export function steppingClock(startIso = "2026-01-01T00:00:00.000Z", stepMs = 1): Clock {
  let current = Date.parse(startIso);
  return () => {
    const reading = new Date(current).toISOString();
    current += stepMs;
    return reading;
  };
}

// Ids look like `tool-3`; each kind counts on its own.
export function sequentialIds(): IdSource {
  const counters = new Map<string, number>();
  return (kind) => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${String(next)}`;
  };
}
