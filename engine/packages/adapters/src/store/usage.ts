import { ok } from "@pica/core";
import type { UsageGrouping, UsageQuery, UsageRecord, UsageRepository, UsageTotals } from "@pica/core";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { attempt } from "./errors.ts";
import { integer, nullableText, real, text } from "./rows.ts";
import type { Row } from "./rows.ts";

export function sqliteUsageRepository(db: DatabaseSync): UsageRepository {
  const insert = db.prepare(`
    INSERT INTO usage_records (session_id, agent, model, input_tokens, cached_tokens,
      output_tokens, credits, tier, timestamp)
    VALUES (:sessionId, :agent, :model, :inputTokens, :cachedTokens, :outputTokens, :credits,
      :tier, :timestamp)
  `);
  const bySession = db.prepare(`
    SELECT session_id, agent, model, input_tokens, cached_tokens, output_tokens, credits, tier, timestamp
    FROM usage_records WHERE session_id = ? ORDER BY id
  `);
  const rollup = (key: string): StatementSync => db.prepare(rollupSql(key));
  const rollups: Record<UsageGrouping, StatementSync> = {
    session: rollup("u.session_id"),
    agent: rollup("u.agent"),
    model: rollup("u.model"),
    workspace: rollup("s.workspace_id"),
    day: rollup("COALESCE(date(u.timestamp), 'unknown')"),
    tier: rollup("COALESCE(u.tier, 'unknown')"),
  };

  return {
    record: (usage) =>
      attempt(() => {
        insert.run({ ...usage });
        return ok(undefined);
      }),
    listBySession: (sessionId) => attempt(() => ok(bySession.all(sessionId).map(toUsage))),
    rollup: (query) =>
      attempt(() => ok(rollups[query.groupBy].all(filters(query)).map(toTotals))),
  };
}

function rollupSql(key: string): string {
  return `
    SELECT ${key} AS key, COUNT(*) AS calls, SUM(u.input_tokens) AS input_tokens,
      SUM(u.cached_tokens) AS cached_tokens, SUM(u.output_tokens) AS output_tokens,
      SUM(u.credits) AS credits
    FROM usage_records u JOIN sessions s ON s.id = u.session_id
    WHERE (:sessionId IS NULL OR u.session_id = :sessionId)
      AND (:workspaceId IS NULL OR s.workspace_id = :workspaceId)
      AND (:from IS NULL OR julianday(u.timestamp) >= julianday(:from))
      AND (:to IS NULL OR julianday(u.timestamp) < julianday(:to))
    GROUP BY 1 ORDER BY 1
  `;
}

function filters(query: UsageQuery): Record<string, string | null> {
  return {
    sessionId: query.sessionId ?? null,
    workspaceId: query.workspaceId ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
  };
}

function toUsage(row: Row): UsageRecord {
  const tier = nullableText(row, "tier");
  return {
    sessionId: text(row, "session_id"),
    agent: text(row, "agent"),
    model: text(row, "model"),
    inputTokens: integer(row, "input_tokens"),
    cachedTokens: integer(row, "cached_tokens"),
    outputTokens: integer(row, "output_tokens"),
    credits: real(row, "credits"),
    tier: tier === "reasoning" || tier === "worker" ? tier : null,
    timestamp: text(row, "timestamp"),
  };
}

function toTotals(row: Row): UsageTotals {
  return {
    key: text(row, "key"),
    calls: integer(row, "calls"),
    inputTokens: integer(row, "input_tokens"),
    cachedTokens: integer(row, "cached_tokens"),
    outputTokens: integer(row, "output_tokens"),
    credits: real(row, "credits"),
  };
}
