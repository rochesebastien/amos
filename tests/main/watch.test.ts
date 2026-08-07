import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScanChangedEvent } from "../../src/shared/ipc.js";
import {
  globalWatchPaths,
  isIgnoredWatchPath,
  isWatchedRootEntry,
  projectWatchPaths,
  WatchManager,
} from "../../src/main/scanner/watch.js";
import { safeWriteFile } from "../../src/main/services/safeWrite.js";
import { clearSelfWrites } from "../../src/main/services/selfWrites.js";

/**
 * The watcher's job is to notice somebody *else* editing the files, and to
 * stay quiet about AMOS's own writes. These tests drive a real chokidar over a
 * temp folder, with polling so the result does not depend on which inotify
 * backend the container happens to offer.
 */

const DEBOUNCE_MS = 60;
/** Generous: a polling watcher needs a couple of intervals to notice. */
const SETTLE_MS = 1_500;

let work: string;
let project: string;
let home: string;
let manager: WatchManager;
let events: ScanChangedEvent[];

beforeEach(async () => {
  work = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "amos-watch-")));
  project = path.join(work, "project");
  home = path.join(work, "home");
  await fs.mkdir(path.join(project, ".claude", "agents"), { recursive: true });
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  clearSelfWrites();
  events = [];
  manager = new WatchManager({
    onChange: (e) => events.push(e),
    home,
    debounceMs: DEBOUNCE_MS,
    usePolling: true,
  });
});

afterEach(async () => {
  await manager.closeAll();
  await fs.rm(work, { recursive: true, force: true });
});

/** Resolve once `predicate` holds, or after `timeout` either way. */
async function waitFor(predicate: () => boolean, timeout = SETTLE_MS): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Give chokidar time to see a change and the debounce time to fire. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, SETTLE_MS));
}

describe("watch paths", () => {
  it("watches only the roots a scan actually reads", () => {
    expect(projectWatchPaths("/p")).toEqual([
      path.join("/p", ".claude"),
      path.join("/p", ".codex"),
      path.join("/p", ".mcp.json"),
      path.join("/p", "CLAUDE.md"),
      path.join("/p", "AGENTS.md"),
    ]);
    expect(globalWatchPaths("/h")).toEqual([
      path.join("/h", ".claude"),
      path.join("/h", ".codex"),
      path.join("/h", ".claude.json"),
    ]);
  });

  it("keeps the flat root watcher to the entries a scan reads", () => {
    expect(isWatchedRootEntry("/p", path.join("/p", "CLAUDE.md"))).toBe(true);
    expect(isWatchedRootEntry("/p", path.join("/p", "AGENTS.md"))).toBe(true);
    expect(isWatchedRootEntry("/p", path.join("/p", ".claude"))).toBe(true);
    expect(isWatchedRootEntry("/p", path.join("/p", "README.md"))).toBe(false);
    // Nested instruction files are read by the scan but not watched: watching
    // them would mean watching the whole tree.
    expect(isWatchedRootEntry("/p", path.join("/p", "packages", "AGENTS.md"))).toBe(false);
  });

  it("ignores the debris of an atomic write and the folders no scan walks", () => {
    expect(isIgnoredWatchPath("/p/.mcp.json.bak")).toBe(true);
    expect(isIgnoredWatchPath("/p/.mcp.json.tmp.4242")).toBe(true);
    expect(isIgnoredWatchPath("/p/node_modules")).toBe(true);
    expect(isIgnoredWatchPath("/p/.git")).toBe(true);
    expect(isIgnoredWatchPath("/p/.claude/agents/a.md")).toBe(false);
  });
});

describe("WatchManager", () => {
  it("reports an external edit under the project's .claude folder", async () => {
    manager.watch("p1", project);
    await new Promise((r) => setTimeout(r, 300));

    await fs.writeFile(path.join(project, ".claude", "agents", "new.md"), "---\nname: n\n---\n");

    await waitFor(() => events.length > 0);
    expect(events.map((e) => e.projectId)).toEqual(["p1"]);
    expect(Date.parse(events[0]!.at)).not.toBeNaN();
  });

  it("reports an external edit of the root CLAUDE.md and AGENTS.md", async () => {
    // Both are watched as files rather than folders, and both may be created
    // *after* the watcher started — which is exactly what "Create CLAUDE.md"
    // does — so the editor open on one of them still learns it moved.
    manager.watch("p1", project);
    await new Promise((r) => setTimeout(r, 300));

    await fs.writeFile(path.join(project, "CLAUDE.md"), "# rules\n");
    await waitFor(() => events.length > 0);
    expect(events[0]!.projectId).toBe("p1");

    events.length = 0;
    await fs.writeFile(path.join(project, "AGENTS.md"), "# rules\n");
    await waitFor(() => events.length > 0);
    expect(events[0]!.projectId).toBe("p1");
  });

  it("says nothing about the rest of the project root", async () => {
    manager.watch("p1", project);
    await new Promise((r) => setTimeout(r, 300));

    await fs.writeFile(path.join(project, "README.md"), "# hi\n");
    await fs.mkdir(path.join(project, "src"), { recursive: true });
    await fs.writeFile(path.join(project, "src", "index.ts"), "export {};\n");

    await settle();
    expect(events).toEqual([]);
  });

  it("coalesces a burst of changes into a single rescan hint", async () => {
    manager.watch("p1", project);
    await new Promise((r) => setTimeout(r, 300));

    for (let i = 0; i < 6; i++) {
      await fs.writeFile(path.join(project, ".claude", "agents", `a${i}.md`), `# ${i}\n`);
    }

    await waitFor(() => events.length > 0);
    await settle();
    expect(events.length).toBe(1);
  });

  it("stays silent when AMOS is the one writing", async () => {
    const target = path.join(project, ".mcp.json");
    await fs.writeFile(target, "{}\n");
    manager.watch("p1", project);
    await new Promise((r) => setTimeout(r, 300));

    await safeWriteFile(target, '{ "mcpServers": {} }\n');

    await settle();
    expect(events).toEqual([]);
  });

  it("fans a change under ~/.claude out to every open project", async () => {
    manager.watch("p1", project);
    const second = path.join(work, "project-2");
    await fs.mkdir(path.join(second, ".claude"), { recursive: true });
    manager.watch("p2", second);
    await new Promise((r) => setTimeout(r, 300));

    await fs.writeFile(path.join(home, ".claude", "CLAUDE.md"), "global rules\n");

    await waitFor(() => events.length >= 2);
    expect(new Set(events.map((e) => e.projectId))).toEqual(new Set(["p1", "p2"]));
  });

  it("goes quiet for a project once it is unwatched", async () => {
    manager.watch("p1", project);
    await new Promise((r) => setTimeout(r, 300));
    await manager.unwatch("p1");
    expect(manager.watched()).toEqual([]);

    await fs.writeFile(path.join(project, ".claude", "agents", "late.md"), "# late\n");

    await settle();
    expect(events).toEqual([]);
  });

  it("watching the same project twice adds no second watcher", () => {
    manager.watch("p1", project);
    manager.watch("p1", project);
    expect(manager.watched()).toEqual(["p1"]);
  });
});
