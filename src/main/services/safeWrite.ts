import fs from "node:fs/promises";
import path from "node:path";
import { WRITE_CONFLICT_CODE } from "../../shared/ipc.js";
import { noteSelfWrite } from "./selfWrites.js";

/**
 * The only way AMOS writes a file.
 *
 * Every file it touches belongs to somebody else's living workspace — a
 * `.mcp.json` another tool reads, a `config.toml` a CLI has open. So a write
 * is: refuse if the file moved under us, spill the new bytes into a sibling
 * temp file, fsync them, keep a `.bak` of what was there, then rename the temp
 * over the target. A crash at any point leaves either the old file intact or
 * the old file plus a stray temp — never a half-written config.
 */

/** How far the on-disk mtime may drift from the expected one, in ms. */
const MTIME_TOLERANCE_MS = 1;

/** Raised when the file changed since the editor last read it. */
export class WriteConflictError extends Error {
  readonly code = WRITE_CONFLICT_CODE;

  constructor(
    readonly filePath: string,
    readonly expectedMtimeMs: number | null,
    readonly actualMtimeMs: number | null,
  ) {
    super(
      `${WRITE_CONFLICT_CODE}: ${filePath} changed on disk ` +
        `(expected mtime ${expectedMtimeMs ?? "none"}, found ${actualMtimeMs ?? "none"}).`,
    );
    this.name = "WriteConflictError";
  }
}

export type SafeWriteOptions = {
  /**
   * `undefined` writes unconditionally (an explicit overwrite), a number
   * requires the file to still carry that mtime, and `null` requires the file
   * not to exist yet (the "create" case).
   */
  expectedMtimeMs?: number | null;
  /** Set to `false` to skip the `.bak` copy. Defaults to `true`. */
  backup?: boolean;
};

export type SafeWriteResult = {
  /** Absolute path written. */
  path: string;
  /** Modification time after the write — the next save's conflict token. */
  mtimeMs: number;
  bytes: number;
  /** The `.bak` written before overwriting, or `null` for a new file. */
  backupPath: string | null;
  /** `true` when the file did not exist before this write. */
  created: boolean;
};

/** `mtimeMs` of a file, or `null` when it does not exist. */
export async function statMtimeMs(filePath: string): Promise<number | null> {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/**
 * Atomically replace (or create) a UTF-8 file.
 *
 * Missing parent directories are created — that is what makes "new skill"
 * a single write of `<skills>/<name>/SKILL.md`.
 */
export async function safeWriteFile(
  filePath: string,
  contents: string,
  options: SafeWriteOptions = {},
): Promise<SafeWriteResult> {
  const target = path.resolve(filePath);
  const dir = path.dirname(target);

  const before = await statOrNull(target);
  assertNoConflict(target, before?.mtimeMs ?? null, options.expectedMtimeMs);

  await fs.mkdir(dir, { recursive: true });

  // Same directory as the target: a rename across filesystems is not atomic,
  // and a temp file in the OS temp dir would frequently be on another one.
  const tmp = `${target}.tmp.${process.pid}`;
  noteSelfWrite(tmp);

  try {
    const handle = await fs.open(tmp, "w", before?.mode ?? 0o644);
    try {
      await handle.writeFile(contents, "utf8");
      // The rename below is only atomic with respect to *durability* once the
      // new bytes are actually on the device.
      await handle.sync();
    } finally {
      await handle.close();
    }

    let backupPath: string | null = null;
    if (before && options.backup !== false) {
      backupPath = `${target}.bak`;
      noteSelfWrite(backupPath);
      await fs.copyFile(target, backupPath);
    }

    noteSelfWrite(target);
    await fs.rename(tmp, target);
    await syncDirectory(dir);

    const after = await fs.stat(target);
    return {
      path: target,
      mtimeMs: after.mtimeMs,
      bytes: after.size,
      backupPath,
      created: before == null,
    };
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Throw a `WriteConflictError` unless the file is in the expected state. */
function assertNoConflict(
  target: string,
  actual: number | null,
  expected: number | null | undefined,
): void {
  if (expected === undefined) return;
  if (expected === null) {
    // "Create" — someone else getting there first is a conflict, not a merge.
    if (actual !== null) throw new WriteConflictError(target, null, actual);
    return;
  }
  if (actual === null) throw new WriteConflictError(target, expected, null);
  if (Math.abs(actual - expected) > MTIME_TOLERANCE_MS) {
    throw new WriteConflictError(target, expected, actual);
  }
}

async function statOrNull(target: string) {
  try {
    return await fs.stat(target);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Flush the directory entry so the rename survives a power loss. Not every
 * platform lets a directory be opened (Windows does not), and failing to make
 * the rename durable is never a reason to fail the save.
 */
async function syncDirectory(dir: string): Promise<void> {
  let handle;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch {
    /* best effort */
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
