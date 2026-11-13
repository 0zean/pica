import { ok } from "@pica/core";
import type { UsageRecord, UsageRepository } from "@pica/core";
import type { DatabaseSync } from "node:sqlite";
import { attempt } from "./errors.ts";
import { integer, real, text } from "./rows.ts";
import type { Row } from "./rows.ts";

export function sqliteUsageRepository(db: DatabaseSync): UsageRepository {
  const insert = db.prepare(`
    INSERT INTO usage_records (session_id, agent, model, input_tokens, cached_tokens,
      output_tokens, credits, timestamp)
    VALUES (:sessionId, :agent, :model, :inputTokens, :cachedTokens, :outputTokens, :credits,
      :timestamp)
  `);
  const bySession = db.prepare(`
    SELECT session_id, agent, model, input_tokens, cached_tokens, output_tokens, credits, timestamp
    FROM usage_records WHERE session_id = ? ORDER BY id
  `);

  return {
    record: (usage) =>
      attempt(() => {
        insert.run({ ...usage });
        return ok(undefined);
      }),
    listBySession: (sessionId) => attempt(() => ok(bySession.all(sessionId).map(toUsage))),
  };
}

function toUsage(row: Row): UsageRecord {
  return {
    sessionId: text(row, "session_id"),
    agent: text(row, "agent"),
    model: text(row, "model"),
    inputTokens: integer(row, "input_tokens"),
    cachedTokens: integer(row, "cached_tokens"),
    outputTokens: integer(row, "output_tokens"),
    credits: real(row, "credits"),
    timestamp: text(row, "timestamp"),
  };
}
