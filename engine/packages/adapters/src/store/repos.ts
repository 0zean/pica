import { ok } from "@pica/core";
import type { CloneState, Repo, RepoRepository, StoreResult } from "@pica/core";
import type { DatabaseSync } from "node:sqlite";
import { attempt, fail } from "./errors.ts";
import { integer, nullableText, text } from "./rows.ts";
import type { Row } from "./rows.ts";

const columns = "id, remote_url, local_path, managed, default_branch, clone_state";

export function sqliteRepoRepository(db: DatabaseSync): RepoRepository {
  const upsert = db.prepare(`
    INSERT INTO repos (${columns})
    VALUES (:id, :remoteUrl, :localPath, :managed, :defaultBranch, :cloneState)
    ON CONFLICT (id) DO UPDATE SET
      remote_url = excluded.remote_url,
      local_path = excluded.local_path,
      managed = excluded.managed,
      default_branch = excluded.default_branch,
      clone_state = excluded.clone_state
  `);
  const byId = db.prepare(`SELECT ${columns} FROM repos WHERE id = ?`);
  const byRemoteUrl = db.prepare(`SELECT ${columns} FROM repos WHERE remote_url = ?`);
  const all = db.prepare(`SELECT ${columns} FROM repos ORDER BY remote_url`);
  const deleteById = db.prepare("DELETE FROM repos WHERE id = ?");

  return {
    save: (repo) =>
      attempt(() => {
        upsert.run({ ...repo, managed: repo.managed ? 1 : 0 });
        return ok(undefined);
      }),
    get: (id) => attempt(() => found(byId.get(id), `repo ${id}`)),
    findByRemoteUrl: (remoteUrl) =>
      attempt(() => found(byRemoteUrl.get(remoteUrl), `repo with remote ${remoteUrl}`)),
    list: () => attempt(() => ok(all.all().map(toRepo))),
    delete: (id) =>
      attempt(() =>
        deleteById.run(id).changes === 0 ? fail("store.not_found", `repo ${id} not found`) : ok(undefined),
      ),
  };
}

function found(row: Row | undefined, what: string): StoreResult<Repo> {
  return row === undefined ? fail("store.not_found", `${what} not found`) : ok(toRepo(row));
}

function toRepo(row: Row): Repo {
  return {
    id: text(row, "id"),
    remoteUrl: text(row, "remote_url"),
    localPath: nullableText(row, "local_path"),
    managed: integer(row, "managed") === 1,
    defaultBranch: nullableText(row, "default_branch"),
    cloneState: text(row, "clone_state") as CloneState,
  };
}
