import path from "node:path";

/**
 * Echo suppression for the file watchers.
 *
 * Every write AMOS performs lands on a path a watcher is looking at, so
 * without this the app would rescan itself after each save. `safeWriteFile`
 * announces the paths it is about to touch here; the watcher drops any event
 * for a path announced within the last `SELF_WRITE_WINDOW_MS`.
 *
 * The window is deliberately generous: filesystem events arrive well after the
 * syscall returns, and a false negative (rescanning our own write) is merely
 * wasteful, while a false positive only costs one debounce cycle of staleness
 * — the next external change re-syncs the UI anyway.
 */

export const SELF_WRITE_WINDOW_MS = 2_000;

/** Absolute path → timestamp after which the entry no longer suppresses. */
const recent = new Map<string, number>();

function key(filePath: string): string {
  return path.resolve(filePath);
}

/** Announce that AMOS is about to write `filePath`. */
export function noteSelfWrite(filePath: string, windowMs = SELF_WRITE_WINDOW_MS): void {
  recent.set(key(filePath), Date.now() + windowMs);
}

/**
 * `true` when the path was written by AMOS recently enough to ignore. Expired
 * entries are pruned on the way through, so the map stays bounded by the
 * number of files edited inside one window.
 */
export function wasSelfWrite(filePath: string, now = Date.now()): boolean {
  const target = key(filePath);
  let hit = false;
  for (const [p, expiry] of recent) {
    if (expiry <= now) {
      recent.delete(p);
      continue;
    }
    if (p === target) hit = true;
  }
  return hit;
}

/** Forget every announcement. Tests use it; the app never needs to. */
export function clearSelfWrites(): void {
  recent.clear();
}
