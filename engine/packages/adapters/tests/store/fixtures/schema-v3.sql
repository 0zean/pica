-- The schema at version 3 (migration "usage tier and time index") with sample rows.
-- Never edit this file to follow later migrations; it stands for databases already in the field.
CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  remote_url TEXT NOT NULL UNIQUE,
  local_path TEXT,
  managed INTEGER NOT NULL CHECK (managed IN (0, 1)),
  default_branch TEXT,
  clone_state TEXT NOT NULL
) STRICT;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sources TEXT NOT NULL,
  settings_overrides TEXT NOT NULL
) STRICT;

CREATE TABLE workspace_pinned_repos (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL REFERENCES repos (id),
  position INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, repo_id)
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  state TEXT NOT NULL,
  write_roots TEXT NOT NULL,
  reference_roots TEXT NOT NULL,
  routing_profile TEXT NOT NULL,
  budget_max_credits REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_by_workspace ON sessions (workspace_id);

CREATE TABLE session_events (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  seq INTEGER NOT NULL CHECK (seq > 0),
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE usage_records (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  cached_tokens INTEGER NOT NULL CHECK (cached_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  credits REAL NOT NULL CHECK (credits >= 0),
  timestamp TEXT NOT NULL
) STRICT;

CREATE INDEX usage_by_session ON usage_records (session_id, id);

INSERT INTO repos VALUES
  ('repo-1', 'github.com/acme/api', '/src/acme/api', 0, 'main', 'ready');
INSERT INTO workspaces VALUES
  ('ws-1', 'Payments', '[{"kind":"team","org":"acme","selector":"payments","lastSyncAt":null}]',
   '{"routing":{"default":"economy"}}');
INSERT INTO workspace_pinned_repos VALUES ('ws-1', 'repo-1', 0);
INSERT INTO sessions VALUES
  ('session-1', 'ws-1', 'idle', '["/src/acme/api"]', '[]', 'balanced', 5.0,
   '2026-11-12T10:00:00.000Z', '2026-11-12T10:00:00.000Z');
INSERT INTO session_events VALUES
  ('session-1', 1, 'session.started', '{}', '2026-11-12T10:00:00.000Z'),
  ('session-1', 2, 'user.message', '{"text":"hello"}', '2026-11-12T10:00:01.000Z'),
  ('session-1', 3, 'session.idle', '{}', '2026-11-12T10:00:02.000Z');
INSERT INTO usage_records VALUES
  (1, 'session-1', 'main', 'model-a', 120, 100, 8, 0.25, '2026-11-12T10:00:01.500Z');

ALTER TABLE usage_records ADD COLUMN tier TEXT CHECK (tier IN ('reasoning', 'worker'));

CREATE INDEX usage_by_time ON usage_records (julianday(timestamp));

INSERT INTO usage_records VALUES
  (2, 'session-1', 'main', 'model-a', 40, 0, 4, 0.1, '2026-11-12T10:00:02.500Z', 'reasoning');

PRAGMA user_version = 3;
