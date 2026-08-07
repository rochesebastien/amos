import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WRITE_CONFLICT_CODE, isWriteConflict } from "../../src/shared/ipc.js";
import { safeWriteFile, statMtimeMs, WriteConflictError } from "../../src/main/services/safeWrite.js";
import { clearSelfWrites, wasSelfWrite } from "../../src/main/services/selfWrites.js";

/**
 * `safeWriteFile` is what stands between AMOS and somebody else's living
 * config files, so these tests are about the guarantees rather than the bytes:
 * a `.bak` exists, a stale editor cannot win, and nothing is left behind.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "amos-safewrite-"));
  clearSelfWrites();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function ls(): Promise<string[]> {
  return (await fs.readdir(dir)).sort();
}

describe("safeWriteFile", () => {
  it("creates a file and leaves no backup and no temp file behind", async () => {
    const target = path.join(dir, "notes.md");
    const result = await safeWriteFile(target, "hello\n");

    expect(result.created).toBe(true);
    expect(result.backupPath).toBeNull();
    expect(await fs.readFile(target, "utf8")).toBe("hello\n");
    expect(await ls()).toEqual(["notes.md"]);
    expect(result.mtimeMs).toBe(await statMtimeMs(target));
  });

  it("creates missing parent directories", async () => {
    const target = path.join(dir, ".claude", "skills", "new-skill", "SKILL.md");
    await safeWriteFile(target, "# skill\n");
    expect(await fs.readFile(target, "utf8")).toBe("# skill\n");
  });

  it("keeps the previous content in a .bak next to the file", async () => {
    const target = path.join(dir, "config.json");
    await fs.writeFile(target, "old\n");

    const result = await safeWriteFile(target, "new\n");

    expect(result.created).toBe(false);
    expect(result.backupPath).toBe(`${target}.bak`);
    expect(await fs.readFile(target, "utf8")).toBe("new\n");
    expect(await fs.readFile(`${target}.bak`, "utf8")).toBe("old\n");
    expect(await ls()).toEqual(["config.json", "config.json.bak"]);
  });

  it("accepts a write whose expected mtime still matches", async () => {
    const target = path.join(dir, "agent.md");
    await safeWriteFile(target, "one\n");
    const mtimeMs = await statMtimeMs(target);

    await expect(safeWriteFile(target, "two\n", { expectedMtimeMs: mtimeMs })).resolves.toBeTruthy();
    expect(await fs.readFile(target, "utf8")).toBe("two\n");
  });

  it("refuses a write whose expected mtime is stale, without touching the file", async () => {
    const target = path.join(dir, "agent.md");
    await safeWriteFile(target, "on disk\n");
    const stale = (await statMtimeMs(target))! - 5_000;

    await expect(
      safeWriteFile(target, "from a stale editor\n", { expectedMtimeMs: stale }),
    ).rejects.toBeInstanceOf(WriteConflictError);

    expect(await fs.readFile(target, "utf8")).toBe("on disk\n");
    expect(await ls()).toEqual(["agent.md"]);
  });

  it("marks the conflict so the renderer can recognise it across the bridge", async () => {
    const target = path.join(dir, "agent.md");
    await safeWriteFile(target, "x\n");
    const error = await safeWriteFile(target, "y\n", { expectedMtimeMs: 1 }).catch((e) => e);

    expect(error.message).toContain(WRITE_CONFLICT_CODE);
    // Electron flattens the error to its message, so this is the real check.
    expect(isWriteConflict(new Error(`Error invoking remote method: ${error.message}`))).toBe(true);
  });

  it("refuses to create a file that already exists when expecting none", async () => {
    const target = path.join(dir, "taken.md");
    await fs.writeFile(target, "someone else got here first\n");

    await expect(safeWriteFile(target, "mine\n", { expectedMtimeMs: null })).rejects.toBeInstanceOf(
      WriteConflictError,
    );
    expect(await fs.readFile(target, "utf8")).toBe("someone else got here first\n");
  });

  it("treats a vanished file as a conflict rather than silently recreating it", async () => {
    const target = path.join(dir, "gone.md");
    await expect(safeWriteFile(target, "back\n", { expectedMtimeMs: 1234 })).rejects.toBeInstanceOf(
      WriteConflictError,
    );
    await expect(fs.stat(target)).rejects.toThrow();
  });

  it("overwrites unconditionally when no mtime is expected", async () => {
    const target = path.join(dir, "agent.md");
    await fs.writeFile(target, "theirs\n");
    await safeWriteFile(target, "mine\n");
    expect(await fs.readFile(target, "utf8")).toBe("mine\n");
  });

  it("announces every path it touches so the watcher ignores the echo", async () => {
    const target = path.join(dir, "watched.json");
    await fs.writeFile(target, "old\n");
    await safeWriteFile(target, "new\n");

    expect(wasSelfWrite(target)).toBe(true);
    expect(wasSelfWrite(`${target}.bak`)).toBe(true);
    expect(wasSelfWrite(path.join(dir, "someone-elses.json"))).toBe(false);
  });

  it("stops suppressing once the window has passed", async () => {
    const target = path.join(dir, "watched.json");
    await safeWriteFile(target, "new\n");
    expect(wasSelfWrite(target, Date.now() + 10_000)).toBe(false);
  });
});
