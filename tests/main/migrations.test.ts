import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/main/db/index.js";
import { LATEST_VERSION, getUserVersion, migrate } from "../../src/main/db/migrations.js";

/**
 * These run in plain Node, against a throwaway directory — `npm test` swaps
 * better-sqlite3 back to the Node ABI first (see the `rebuild:node` script).
 */

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "amos-db-"));
  file = path.join(dir, "nested", "amos.db");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function tableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all()
    .map((r) => r.name);
}

describe("migrations", () => {
  it("creates the v1 schema and stamps user_version", () => {
    const db = openDatabase(file);
    expect(getUserVersion(db)).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(1);
    expect(tableNames(db)).toEqual(["chat_messages", "chat_sessions", "projects", "settings"]);
    db.close();
  });

  it("creates the parent directory of the database file", () => {
    expect(fs.existsSync(path.dirname(file))).toBe(false);
    openDatabase(file).close();
    expect(fs.existsSync(file)).toBe(true);
  });

  it("is idempotent — reopening an up-to-date database changes nothing", () => {
    const first = openDatabase(file);
    first.prepare(`INSERT INTO settings (key, value) VALUES ('language', 'fr')`).run();
    first.close();

    const second = openDatabase(file);
    expect(getUserVersion(second)).toBe(LATEST_VERSION);
    expect(
      second.prepare<[], { value: string }>(`SELECT value FROM settings WHERE key = 'language'`).get()
        ?.value,
    ).toBe("fr");
    second.close();
  });

  it("applies pending migrations to an empty database", () => {
    const db = new Database(":memory:");
    expect(getUserVersion(db)).toBe(0);
    expect(migrate(db)).toBe(LATEST_VERSION);
    expect(tableNames(db)).toContain("projects");
    db.close();
  });

  it("refuses a database written by a newer build", () => {
    const db = new Database(":memory:");
    db.pragma(`user_version = ${LATEST_VERSION + 5}`);
    expect(() => migrate(db)).toThrow(/newer than this build/);
    db.close();
  });

  it("enforces the chat foreign keys and their cascade", () => {
    const db = openDatabase(file);
    expect(() =>
      db
        .prepare(
          `INSERT INTO chat_sessions (id, project_id, backend, created_at, updated_at)
           VALUES ('s1', 'ghost', 'claude', '2026-01-01', '2026-01-01')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);

    db.prepare(
      `INSERT INTO projects (id, path, name, created_at) VALUES ('p1', '/tmp/x', 'x', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO chat_sessions (id, project_id, backend, created_at, updated_at)
       VALUES ('s1', 'p1', 'claude', '2026-01-01', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, created_at)
       VALUES ('m1', 's1', 'user', 'hello', '2026-01-01')`,
    ).run();

    db.prepare(`DELETE FROM projects WHERE id = 'p1'`).run();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_sessions`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_messages`).get()).toEqual({ n: 0 });
    db.close();
  });
});
