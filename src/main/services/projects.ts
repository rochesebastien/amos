import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project } from "../../shared/ipc.js";
import { getDatabase, type Db } from "../db/index.js";

/**
 * Projects are folders on disk that the user pointed AMOS at. The rows here
 * are only a bookmark list — capabilities are never persisted, the filesystem
 * stays the single source of truth.
 */

type ProjectRow = {
  id: string;
  path: string;
  name: string;
  created_at: string;
  last_opened_at: string | null;
};

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  };
}

/** Absolute, symlink-resolved, trailing-slash-free path of an existing folder. */
export function normalizeProjectPath(input: string): string {
  const expanded = input.trim();
  if (!expanded) throw new Error("A project path is required.");
  const absolute = path.resolve(expanded);
  let real: string;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    throw new Error(`This folder does not exist: ${absolute}`);
  }
  if (!fs.statSync(real).isDirectory()) {
    throw new Error(`This path is not a folder: ${real}`);
  }
  return real;
}

/** Folder basename, with a sane fallback for roots like `/` or `C:\`. */
export function projectNameFor(projectPath: string): string {
  const base = path.basename(projectPath);
  return base || projectPath;
}

export function listProjects(db: Db = getDatabase()): Project[] {
  const rows = db
    .prepare<[], ProjectRow>(
      `SELECT id, path, name, created_at, last_opened_at
         FROM projects
        ORDER BY COALESCE(last_opened_at, created_at) DESC, name ASC`,
    )
    .all();
  return rows.map(toProject);
}

export function getProject(id: string, db: Db = getDatabase()): Project | null {
  const row = db
    .prepare<[string], ProjectRow>(
      `SELECT id, path, name, created_at, last_opened_at FROM projects WHERE id = ?`,
    )
    .get(id);
  return row ? toProject(row) : null;
}

export function getProjectByPath(projectPath: string, db: Db = getDatabase()): Project | null {
  const row = db
    .prepare<[string], ProjectRow>(
      `SELECT id, path, name, created_at, last_opened_at FROM projects WHERE path = ?`,
    )
    .get(projectPath);
  return row ? toProject(row) : null;
}

/**
 * Register a folder as a project. Adding a folder that is already known is
 * not an error — it just touches the existing row, which is what "open this
 * folder again" means from the UI.
 */
export function addProject(input: { path: string }, db: Db = getDatabase()): Project {
  const projectPath = normalizeProjectPath(input.path);
  const existing = getProjectByPath(projectPath, db);
  if (existing) return touchProject(existing.id, db);

  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    path: projectPath,
    name: projectNameFor(projectPath),
    createdAt: now,
    lastOpenedAt: now,
  };
  db.prepare(
    `INSERT INTO projects (id, path, name, created_at, last_opened_at)
     VALUES (@id, @path, @name, @createdAt, @lastOpenedAt)`,
  ).run(project);
  return project;
}

/** Forget a project. The folder on disk is never touched. */
export function removeProject(id: string, db: Db = getDatabase()): { ok: true } {
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  return { ok: true };
}

/** Move a project to the top of the recents list. */
export function touchProject(id: string, db: Db = getDatabase()): Project {
  const now = new Date().toISOString();
  const res = db.prepare(`UPDATE projects SET last_opened_at = ? WHERE id = ?`).run(now, id);
  if (res.changes === 0) throw new Error(`Unknown project: ${id}`);
  return getProject(id, db) as Project;
}
