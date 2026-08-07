import type { SettingValue } from "../../shared/ipc.js";
import { getDatabase, type Db } from "../db/index.js";

/**
 * A flat key/value store for app preferences that must survive a reinstall of
 * the renderer's localStorage (language, chat backend, …). Values are opaque
 * strings; callers own their encoding.
 */

export function getSetting(key: string, db: Db = getDatabase()): SettingValue {
  const row = db
    .prepare<[string], { value: string }>(`SELECT value FROM settings WHERE key = ?`)
    .get(key);
  return { key, value: row ? row.value : null };
}

export function setSetting(key: string, value: string, db: Db = getDatabase()): SettingValue {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
  return { key, value };
}

export function allSettings(db: Db = getDatabase()): Record<string, string> {
  const rows = db
    .prepare<[], { key: string; value: string }>(`SELECT key, value FROM settings`)
    .all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
