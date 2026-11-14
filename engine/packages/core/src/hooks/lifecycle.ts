import type { SessionLifecycleEvent } from "../sessions/index.ts";
import { runUserHooks } from "./run.ts";
import type { HookRunReport, UserHookDeps } from "./types.ts";

// `sessionStart` and `sessionEnd` hooks for the session service. They never block the session;
// each run is handed to `onReport`.
export function userHookLifecycle(
  deps: UserHookDeps,
  onReport: (report: HookRunReport, sessionId: string) => void,
): (event: SessionLifecycleEvent) => Promise<void> {
  return async (event) => {
    const scope = { cwd: event.directory, writeRoots: event.writeRoots, referenceRoots: event.referenceRoots };
    const report = await runUserHooks(deps, event.kind, scope, { PICA_SESSION_ID: event.sessionId });
    onReport(report, event.sessionId);
  };
}
