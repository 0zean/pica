import { ok } from "@pica/core";
import type {
  JsonObject,
  RepoSource,
  StoreResult,
  Workspace,
  WorkspaceRepository,
} from "@pica/core";
import type { DatabaseSync } from "node:sqlite";
import { inTransaction } from "./database.ts";
import { attempt, fail } from "./errors.ts";
import { json, text } from "./rows.ts";
import type { Row } from "./rows.ts";

export function sqliteWorkspaceRepository(db: DatabaseSync): WorkspaceRepository {
  const upsert = db.prepare(`
    INSERT INTO workspaces (id, name, sources, settings_overrides)
    VALUES (:id, :name, :sources, :settingsOverrides)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      sources = excluded.sources,
      settings_overrides = excluded.settings_overrides
  `);
  const clearPins = db.prepare("DELETE FROM workspace_pinned_repos WHERE workspace_id = ?");
  const pin = db.prepare(
    "INSERT INTO workspace_pinned_repos (workspace_id, repo_id, position) VALUES (?, ?, ?)",
  );
  const byId = db.prepare("SELECT id, name, sources, settings_overrides FROM workspaces WHERE id = ?");
  const all = db.prepare("SELECT id, name, sources, settings_overrides FROM workspaces ORDER BY name, id");
  const pins = db.prepare(
    "SELECT repo_id FROM workspace_pinned_repos WHERE workspace_id = ? ORDER BY position",
  );
  const remove = db.prepare("DELETE FROM workspaces WHERE id = ?");

  function toWorkspace(row: Row): Workspace {
    const id = text(row, "id");
    return {
      id,
      name: text(row, "name"),
      sources: json(row, "sources") as unknown as readonly RepoSource[],
      pinnedRepoIds: pins.all(id).map((pinRow) => text(pinRow, "repo_id")),
      settingsOverrides: json(row, "settings_overrides") as JsonObject,
    };
  }

  function get(id: string): StoreResult<Workspace> {
    const row = byId.get(id);
    return row === undefined ? fail("store.not_found", `workspace ${id} not found`) : ok(toWorkspace(row));
  }

  return {
    save: (workspace) =>
      attempt(() =>
        inTransaction(db, () => {
          upsert.run({
            id: workspace.id,
            name: workspace.name,
            sources: JSON.stringify(workspace.sources),
            settingsOverrides: JSON.stringify(workspace.settingsOverrides),
          });
          clearPins.run(workspace.id);
          workspace.pinnedRepoIds.forEach((repoId, position) => {
            pin.run(workspace.id, repoId, position);
          });
          return ok(undefined);
        }),
      ),
    get: (id) => attempt(() => get(id)),
    list: () => attempt(() => ok(all.all().map(toWorkspace))),
    delete: (id) =>
      attempt(() =>
        remove.run(id).changes === 0 ? fail("store.not_found", `workspace ${id} not found`) : ok(undefined),
      ),
  };
}
