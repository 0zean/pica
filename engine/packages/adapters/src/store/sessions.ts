import { ok } from "@pica/core";
import type { Session, SessionRepository, SessionState, StoreResult } from "@pica/core";
import type { DatabaseSync } from "node:sqlite";
import { attempt, fail } from "./errors.ts";
import { json, nullableReal, text } from "./rows.ts";
import type { Row } from "./rows.ts";

const columns = `id, workspace_id, state, write_roots, reference_roots, routing_profile,
  budget_max_credits, created_at, updated_at`;

export function sqliteSessionRepository(db: DatabaseSync): SessionRepository {
  const insert = db.prepare(`
    INSERT INTO sessions (${columns})
    VALUES (:id, :workspaceId, :state, :writeRoots, :referenceRoots, :routingProfile,
      :budgetMaxCredits, :createdAt, :updatedAt)
  `);
  const byId = db.prepare(`SELECT ${columns} FROM sessions WHERE id = ?`);
  const byWorkspace = db.prepare(
    `SELECT ${columns} FROM sessions WHERE workspace_id = ? ORDER BY created_at, id`,
  );
  const setState = db.prepare("UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?");

  return {
    create: (session) =>
      attempt(() => {
        insert.run({
          ...session,
          writeRoots: JSON.stringify(session.writeRoots),
          referenceRoots: JSON.stringify(session.referenceRoots),
        });
        return ok(undefined);
      }),
    get: (id) => attempt(() => found(byId.get(id), id)),
    listByWorkspace: (workspaceId) => attempt(() => ok(byWorkspace.all(workspaceId).map(toSession))),
    updateState: (id, state, updatedAt) =>
      attempt(() =>
        setState.run(state, updatedAt, id).changes === 0
          ? fail("store.not_found", `session ${id} not found`)
          : ok(undefined),
      ),
  };
}

function found(row: Row | undefined, id: string): StoreResult<Session> {
  return row === undefined ? fail("store.not_found", `session ${id} not found`) : ok(toSession(row));
}

function toSession(row: Row): Session {
  return {
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    state: text(row, "state") as SessionState,
    writeRoots: json(row, "write_roots") as readonly string[],
    referenceRoots: json(row, "reference_roots") as readonly string[],
    routingProfile: text(row, "routing_profile"),
    budgetMaxCredits: nullableReal(row, "budget_max_credits"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}
