import fs from "node:fs/promises";
import path from "node:path";
import type { FsEntry, ListDirResult, ReadFileResult } from "../../shared/ipc.js";
import { toPosix } from "../scanner/fsutil.js";

/**
 * The generic file operations behind `fs:readFile` / `fs:listDir`. Path
 * containment happens one layer up, in the IPC handler: everything here has
 * already been resolved and proven to sit inside an allowed root.
 */

/** Files larger than this are refused: the editor is for text, not blobs. */
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

/** How deep `fs:listDir` walks by default. */
export const DEFAULT_LIST_DEPTH = 4;

/** Hard cap on one listing, so a mistakenly huge folder cannot flood the UI. */
export const MAX_LIST_ENTRIES = 2_000;

/** Folders no listing descends into. */
const SKIPPED = new Set(["node_modules", ".git", "__pycache__", ".venv"]);

export async function readTextFile(filePath: string): Promise<ReadFileResult> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`${filePath} is not a file.`);
  if (stat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(
      `${filePath} is ${stat.size} bytes — AMOS only opens text files up to ${MAX_TEXT_FILE_BYTES}.`,
    );
  }
  const content = await fs.readFile(filePath, "utf8");
  return { path: filePath, content, mtimeMs: stat.mtimeMs, bytes: stat.size };
}

/**
 * Recursive listing of a folder, files and directories alike, sorted
 * directories-first then alphabetically — the order the skill editor's tree
 * renders in. A missing folder lists as empty rather than throwing: a skill
 * being created has no folder yet.
 */
export async function listDirectory(
  root: string,
  maxDepth = DEFAULT_LIST_DEPTH,
): Promise<ListDirResult> {
  const entries: FsEntry[] = [];
  let truncated = false;

  const visit = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return;
    let children;
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw err;
    }
    children.sort(
      (a, b) =>
        Number(!a.isDirectory()) - Number(!b.isDirectory()) || a.name.localeCompare(b.name),
    );
    for (const child of children) {
      if (entries.length >= MAX_LIST_ENTRIES) {
        truncated = true;
        return;
      }
      const absolute = path.join(dir, child.name);
      const relativePath = toPosix(path.relative(root, absolute));
      if (child.isDirectory()) {
        if (SKIPPED.has(child.name)) continue;
        entries.push({
          name: child.name,
          relativePath,
          path: absolute,
          kind: "directory",
          bytes: 0,
        });
        if (depth < maxDepth) await visit(absolute, depth + 1);
        continue;
      }
      // Symlinks report as neither file nor directory here, which keeps the
      // walk free of loops and of paths that leave the tree.
      if (!child.isFile()) continue;
      let bytes = 0;
      try {
        bytes = (await fs.stat(absolute)).size;
      } catch {
        /* vanished mid-walk */
      }
      entries.push({ name: child.name, relativePath, path: absolute, kind: "file", bytes });
    }
  };

  await visit(root, 1);
  return { path: root, entries, truncated };
}
