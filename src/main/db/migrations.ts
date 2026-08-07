import type { Database } from "better-sqlite3";

/**
 * Schema migrations, applied in order. The applied version is tracked with
 * SQLite's own `PRAGMA user_version`, so no bookkeeping table is needed.
 *
 * Rules: never edit a shipped migration — append a new one instead.
 */
export type Migration = {
  /** 1-based, contiguous, matches the `user_version` written after `up`. */
  version: number;
  up(db: Database): void;
};

export const migrations: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE projects (
          id             TEXT PRIMARY KEY,
          path           TEXT NOT NULL UNIQUE,
          name           TEXT NOT NULL,
          created_at     TEXT NOT NULL,
          last_opened_at TEXT
        );

        CREATE TABLE chat_sessions (
          id         TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          backend    TEXT NOT NULL,
          title      TEXT NOT NULL DEFAULT '',
          -- Opaque token handed back to the CLI driver to continue a session.
          resume_token TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_chat_sessions_project ON chat_sessions(project_id, updated_at DESC);

        CREATE TABLE chat_messages (
          id         TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL DEFAULT '',
          -- JSON blob for tool calls, attachments and other per-message extras.
          extra      TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);

        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];

/** The version the code expects the database to be at. */
export const LATEST_VERSION = migrations.reduce((max, m) => Math.max(max, m.version), 0);

export function getUserVersion(db: Database): number {
  return db.pragma("user_version", { simple: true }) as number;
}

/**
 * Bring `db` up to `LATEST_VERSION`. Each migration runs in its own
 * transaction together with the `user_version` bump, so a crash mid-way
 * leaves the database on the last fully applied version.
 */
export function migrate(db: Database): number {
  const current = getUserVersion(db);
  if (current > LATEST_VERSION) {
    throw new Error(
      `Database schema v${current} is newer than this build of AMOS (v${LATEST_VERSION}).`,
    );
  }
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.transaction(() => {
      m.up(db);
      // `user_version` takes no bound parameters.
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return getUserVersion(db);
}
