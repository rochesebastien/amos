import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PATH_DENIED_CODE } from "../../shared/ipc.js";

/**
 * Path containment for every filesystem channel.
 *
 * The renderer is sandboxed but not trusted: a path crossing the bridge is
 * just a string, and `.mcp.json` or a skill file is only ever *inside* a
 * folder the user registered, or inside `~/.claude` / `~/.codex`. Anything
 * else — traversal, an absolute path elsewhere, a symlink pointing out of the
 * tree — is refused before a single byte is read or written.
 */

/** Raised when a path is outside every allowed root. */
export class PathAccessError extends Error {
  readonly code = PATH_DENIED_CODE;

  constructor(readonly requested: string) {
    super(`${PATH_DENIED_CODE}: ${requested} is outside the folders AMOS may touch.`);
    this.name = "PathAccessError";
  }
}

export type AllowedRoots = {
  /** Directories whose whole subtree is reachable. */
  dirs: string[];
  /** Individual files that are reachable although their folder is not. */
  files: string[];
};

/**
 * The roots AMOS may read and write: every registered project, plus the two
 * global capability folders. `~/.claude.json` is listed as a file of its own —
 * it sits directly in the home folder, which is *not* otherwise reachable.
 */
export function buildAllowedRoots(
  projectPaths: readonly string[],
  home: string = os.homedir(),
): AllowedRoots {
  return {
    dirs: [
      ...projectPaths.map((p) => path.resolve(p)),
      path.resolve(home, ".claude"),
      path.resolve(home, ".codex"),
    ],
    files: [path.resolve(home, ".claude.json")],
  };
}

/**
 * Resolve a path crossing the bridge and prove it lands inside `roots`.
 *
 * Symlinks are followed first: the deepest *existing* ancestor is realpath'ed
 * and the still-missing tail is appended to it, so both an existing file
 * reached through a symlink and a new file created under one are judged on
 * where they really are. The returned path is the real one — callers must use
 * it rather than the string they were handed.
 */
export async function resolveAllowedPath(
  requested: string,
  roots: AllowedRoots,
): Promise<string> {
  if (typeof requested !== "string" || requested === "" || requested.includes("\0")) {
    throw new PathAccessError(String(requested));
  }
  const real = await realpathDeep(requested);

  const dirs = await Promise.all(roots.dirs.map(realpathDeep));
  if (dirs.some((root) => contains(root, real))) return real;

  const files = await Promise.all(roots.files.map(realpathDeep));
  if (files.some((file) => file === real)) return real;

  throw new PathAccessError(requested);
}

/** `true` when `target` is `root` itself or sits below it. */
export function contains(root: string, target: string): boolean {
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}

/**
 * `fs.realpath` that tolerates a path which does not exist yet: it walks up to
 * the first existing ancestor, resolves that, and re-appends the missing tail.
 * The tail cannot hide a symlink — nothing along it exists.
 */
export async function realpathDeep(target: string): Promise<string> {
  const resolved = path.resolve(target);
  const tail: string[] = [];
  let current = resolved;

  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length ? path.join(real, ...tail) : real;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // ELOOP: a symlink cycle is not a path we will ever serve.
      if (code !== "ENOENT" && code !== "ENOTDIR") return resolved;
    }
    const parent = path.dirname(current);
    if (parent === current) return resolved;
    tail.unshift(path.basename(current));
    current = parent;
  }
}
