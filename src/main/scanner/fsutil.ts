import fs from "node:fs/promises";
import path from "node:path";
import type { CapabilityItem, InstructionFile, ScanError } from "../../shared/capabilities.js";

/**
 * Filesystem helpers shared by the Claude and Codex scanners. Everything here
 * is defensive: a project folder is someone else's living workspace, so a
 * missing or unreadable path is data (a `ScanError`), never a thrown scan.
 */

/** Directories the recursive walks never descend into. */
export const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

/** Accumulator every scanner writes into. */
export type ScanCollector = {
  errors: ScanError[];
};

/** What one scanner pass (an ecosystem × a scope) contributes to the scan. */
export type ScanChunk = ScanCollector & {
  items: CapabilityItem[];
  instructions: InstructionFile[];
};

export function newChunk(): ScanChunk {
  return { items: [], instructions: [], errors: [] };
}

/** Merge chunks in order; used by `scanProject` to assemble the final scan. */
export function mergeChunks(chunks: ScanChunk[]): ScanChunk {
  const out = newChunk();
  for (const chunk of chunks) {
    out.items.push(...chunk.items);
    out.instructions.push(...chunk.instructions);
    out.errors.push(...chunk.errors);
  }
  return out;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `true` when the path exists and is a directory. */
export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** `true` when the path exists and is a regular file. */
export async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

/** Size in bytes, or 0 when the file vanished mid-scan. */
export async function fileSize(target: string): Promise<number> {
  try {
    return (await fs.stat(target)).size;
  } catch {
    return 0;
  }
}

/**
 * Modification time in ms, or 0 when the file vanished mid-scan. Editors send
 * it back as `expectedMtimeMs`, so 0 simply means "no conflict token".
 */
export async function fileMtimeMs(target: string): Promise<number> {
  try {
    return (await fs.stat(target)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Read a UTF-8 file. Returns `null` when the file does not exist; records a
 * `ScanError` and returns `null` for any other failure (permissions, …).
 */
export async function readTextFile(
  target: string,
  collector: ScanCollector,
): Promise<string | null> {
  try {
    return await fs.readFile(target, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      collector.errors.push({ path: target, message: errorMessage(err) });
    }
    return null;
  }
}

/**
 * Direct children of a directory. A missing directory yields `[]` — most of
 * the paths AMOS looks for simply do not exist in a given project.
 */
export async function readDirectory(
  target: string,
  collector: ScanCollector,
): Promise<{ name: string; isDirectory: boolean; isFile: boolean }[]> {
  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      collector.errors.push({ path: target, message: errorMessage(err) });
    }
    return [];
  }
  return entries
    .map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type WalkedFile = {
  /** Absolute path. */
  path: string;
  /** Path relative to the walk root, with `/` separators. */
  relativePath: string;
  /** 1 for a file sitting directly in the root. */
  depth: number;
};

export type WalkOptions = {
  /**
   * How many directory levels below the root to descend into. `1` visits only
   * the root's own files; `4` also visits files four folders down.
   */
  maxDepth: number;
  /** Skip dot-directories on top of `node_modules` / `.git`. */
  skipDotDirs?: boolean;
};

/**
 * Depth-limited recursive file walk. Symlinked directories are not followed:
 * `withFileTypes` reports a symlink as neither file nor directory, which keeps
 * the walk free of loops.
 */
export async function walkFiles(
  root: string,
  options: WalkOptions,
  collector: ScanCollector,
): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];

  const visit = async (dir: string, depth: number): Promise<void> => {
    const entries = await readDirectory(dir, collector);
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isFile) {
        out.push({
          path: absolute,
          relativePath: toPosix(path.relative(root, absolute)),
          depth,
        });
        continue;
      }
      if (!entry.isDirectory) continue;
      if (SKIPPED_DIRS.has(entry.name)) continue;
      if (options.skipDotDirs !== false && entry.name.startsWith(".")) continue;
      if (depth >= options.maxDepth) continue;
      await visit(absolute, depth + 1);
    }
  };

  await visit(root, 1);
  return out;
}

/** Normalise a relative path to `/` separators for display and ids. */
export function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}
