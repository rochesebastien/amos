import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findRootInstruction,
  hasRootInstruction,
  instructionId,
  ROOT_INSTRUCTION_FILES,
} from "../../src/shared/capabilities.js";
import { isWriteConflict } from "../../src/shared/ipc.js";
import { scanProject } from "../../src/main/scanner/index.js";
import { buildAllowedRoots, PathAccessError, resolveAllowedPath } from "../../src/main/services/paths.js";
import { safeWriteFile } from "../../src/main/services/safeWrite.js";
import { clearSelfWrites } from "../../src/main/services/selfWrites.js";
import { projectWatchPaths } from "../../src/main/scanner/watch.js";

/**
 * Creating a `CLAUDE.md` / `AGENTS.md` that does not exist yet.
 *
 * This walks the same three layers the `fs:writeFile` handler does — the
 * allowed-roots check, then `safeWriteFile`, then the next scan — because the
 * interesting question is about a path that is *not there yet*: containment
 * must still say yes, the create guard must still say no the second time, and
 * the scanner must pick the new file up without anything being told about it.
 */

let work: string;
let project: string;
let home: string;

beforeEach(async () => {
  // realpath: macOS temp dirs are symlinked, and containment compares real paths.
  work = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "amos-instructions-")));
  project = path.join(work, "project");
  home = path.join(work, "home");
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  clearSelfWrites();
});

afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

/** The `fs:writeFile` handler, minus Electron: contain, then write. */
async function writeThroughIpc(
  target: string,
  content: string,
  expectedMtimeMs?: number | null,
): Promise<string> {
  const roots = buildAllowedRoots([project], home);
  const allowed = await resolveAllowedPath(target, roots);
  const result = await safeWriteFile(allowed, content, { expectedMtimeMs });
  return result.path;
}

function scan() {
  return scanProject(project, { home, includeGlobal: false });
}

describe("creating an instruction file", () => {
  it("allows a CLAUDE.md that does not exist yet, and lands it in the next scan", async () => {
    const before = await scan();
    expect(before.instructions).toEqual([]);
    expect(hasRootInstruction(before.instructions, "CLAUDE.md")).toBe(false);

    const target = path.join(project, "CLAUDE.md");
    const written = await writeThroughIpc(target, "# demo\n\nProject instructions.\n", null);
    expect(written).toBe(target);

    const after = await scan();
    const created = findRootInstruction(after.instructions, "CLAUDE.md");
    expect(created).toBeDefined();
    expect(created!.ecosystem).toBe("claude");
    expect(created!.scope).toBe("project");
    expect(created!.path).toBe(target);
    expect(created!.relativePath).toBe("CLAUDE.md");
    expect(created!.bytes).toBeGreaterThan(0);
    // The id the renderer routes to is derived from the path alone, so the
    // editor can be reached without waiting for the scan to name it.
    expect(created!.id).toBe(instructionId(target));
  });

  it("reports an mtime the editor can use as its conflict token", async () => {
    const target = path.join(project, "AGENTS.md");
    await writeThroughIpc(target, "# demo\n", null);

    const found = findRootInstruction((await scan()).instructions, "AGENTS.md");
    expect(found?.ecosystem).toBe("codex");
    expect(found?.mtimeMs).toBe((await fs.stat(target)).mtimeMs);
    expect(found?.mtimeMs).toBeGreaterThan(0);
  });

  it("refuses to create over a file that appeared in the meantime", async () => {
    const target = path.join(project, "CLAUDE.md");
    await writeThroughIpc(target, "first\n", null);

    await expect(writeThroughIpc(target, "second\n", null)).rejects.toSatisfy(isWriteConflict);
    expect(await fs.readFile(target, "utf8")).toBe("first\n");
  });

  it("refuses an instruction file outside the project", async () => {
    const outside = path.join(work, "CLAUDE.md");
    await expect(writeThroughIpc(outside, "nope\n", null)).rejects.toBeInstanceOf(PathAccessError);
    await expect(fs.stat(outside)).rejects.toThrow();
  });

  it("creates both root instruction files where each CLI looks for them", async () => {
    for (const { name } of ROOT_INSTRUCTION_FILES) {
      await writeThroughIpc(path.join(project, name), `# ${name}\n`, null);
    }

    const result = await scan();
    expect(result.instructions.map((i) => `${i.ecosystem}:${i.relativePath}`).sort()).toEqual([
      "claude:CLAUDE.md",
      "codex:AGENTS.md",
    ]);
    // Both are watched roots, so an external edit becomes a `scan:changed`.
    for (const { name } of ROOT_INSTRUCTION_FILES) {
      expect(projectWatchPaths(project)).toContain(path.join(project, name));
    }
  });
});
