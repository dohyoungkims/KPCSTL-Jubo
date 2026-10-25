-- Standalone Worker database. The original Sites migrations remain unchanged.
CREATE TABLE members (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE issues (
  id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL,
  document TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE issue_versions (
  issue_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  document TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (issue_id,version)
);
CREATE TABLE editor_access (
  id TEXT PRIMARY KEY NOT NULL REFERENCES members(id),
  role TEXT NOT NULL CHECK (role IN ('admin','editor')),
  code_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE access_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  editor_id TEXT NOT NULL REFERENCES editor_access(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX access_sessions_editor ON access_sessions(editor_id);
