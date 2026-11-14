import { SessionEvent as SessionEventSchema } from "@pica/protocol";
import type { SessionEvent } from "@pica/protocol";
import { checkPayload } from "../events/validate.ts";
import type { JsonObject, JsonValue } from "../json.ts";
import { buildDiagnosticsBundle } from "../redaction/index.ts";
import type { DiagnosticsBundle, DiagnosticsSessionInput } from "../redaction/index.ts";
import type { Session, Store } from "../store/index.ts";

export interface CollectDiagnosticsInput {
  readonly store: Pick<Store, "workspaces" | "sessions" | "events">;
  readonly generatedAt: string;
  readonly environment: JsonObject;
  readonly config: JsonValue;
  readonly logs: readonly string[];
  // The most recently updated sessions are included; older ones are left out.
  readonly maxSessions?: number;
}

export const defaultDiagnosticsSessions = 20;

// Gathers the engine's state for H-03's bundle. A store read that fails is recorded under
// `environment.collectionErrors` instead of failing the bundle, which is wanted most when things break.
export function collectDiagnostics(input: CollectDiagnosticsInput): DiagnosticsBundle {
  const problems: string[] = [];
  const sessions = recentSessions(input.store, input.maxSessions ?? defaultDiagnosticsSessions, problems);
  const entries: DiagnosticsSessionInput[] = sessions.map((session) => ({
    session: sessionSummary(session),
    events: sessionEvents(input.store, session.id, problems),
  }));
  return buildDiagnosticsBundle({
    generatedAt: input.generatedAt,
    environment: problems.length === 0 ? input.environment : { ...input.environment, collectionErrors: problems },
    config: input.config,
    sessions: entries,
    logs: input.logs,
  });
}

function recentSessions(store: CollectDiagnosticsInput["store"], limit: number, problems: string[]): Session[] {
  const workspaces = store.workspaces.list();
  if (!workspaces.ok) {
    problems.push(`workspaces: ${workspaces.error.message}`);
    return [];
  }
  const sessions: Session[] = [];
  for (const workspace of workspaces.value) {
    const listed = store.sessions.listByWorkspace(workspace.id);
    if (listed.ok) {
      sessions.push(...listed.value);
    } else {
      problems.push(`sessions of ${workspace.id}: ${listed.error.message}`);
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, limit);
}

function sessionSummary(session: Session): JsonObject {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    state: session.state,
    routingProfile: session.routingProfile,
    budgetMaxCredits: session.budgetMaxCredits,
    writeRoots: [...session.writeRoots],
    referenceRoots: [...session.referenceRoots],
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function sessionEvents(store: CollectDiagnosticsInput["store"], sessionId: string, problems: string[]): SessionEvent[] {
  const rows = store.events.readAfter(sessionId, 0);
  if (!rows.ok) {
    problems.push(`events of ${sessionId}: ${rows.error.message}`);
    return [];
  }
  const events: SessionEvent[] = [];
  for (const row of rows.value) {
    const parsed = checkPayload(SessionEventSchema, row);
    if (parsed.ok) {
      // The schema accepted it, so it is one of the union's variants.
      events.push(parsed.value as SessionEvent);
    } else {
      problems.push(`event ${String(row.seq)} of ${sessionId} does not match the protocol`);
    }
  }
  return events;
}
