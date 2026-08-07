import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrations.js";

/**
 * The application database lives in `userData/amos.db`, but nothing here
 * imports Electron: the caller passes the file path in. That keeps the whole
 * persistence layer runnable from plain Node in the vitest suites.
 */

let instance: Database.Database | null = null;

/** Open (creating it if needed) and migrate a database file. */
export function openDatabase(file: string): Database.Database {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  // WAL keeps reads from blocking the single writer; foreign keys are off by
  // default in SQLite and our cascades depend on them.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** Open the process-wide database. Called once, from the main process boot. */
export function initDatabase(file: string): Database.Database {
  closeDatabase();
  instance = openDatabase(file);
  return instance;
}

/** The process-wide database. Throws when `initDatabase` has not run yet. */
export function getDatabase(): Database.Database {
  if (!instance) {
    throw new Error("Database not initialised — call initDatabase() first.");
  }
  return instance;
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}

export { migrate, LATEST_VERSION, getUserVersion } from "./migrations.js";

/** Handy alias so services don't have to reach into the better-sqlite3 namespace. */
export type Db = Database.Database;
