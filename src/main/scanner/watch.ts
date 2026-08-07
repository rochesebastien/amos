import os from "node:os";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { ScanChangedEvent } from "../../shared/ipc.js";
import { wasSelfWrite } from "../services/selfWrites.js";
import { CLAUDE_DIR, CLAUDE_INSTRUCTIONS, CLAUDE_MCP_FILE } from "./claude.js";
import { CODEX_DIR, CODEX_INSTRUCTIONS } from "./codex.js";

/**
 * Filesystem watching for the projects the window has open.
 *
 * AMOS never watches a whole project folder — that would mean an inotify
 * handle per source file of somebody's monorepo. It watches only the handful
 * of roots the scanner actually reads, plus the two global folders, which are
 * shared by every open project, plus the project root itself — flat, and
 * filtered to those same few names, because chokidar never adopts a path that
 * did not exist when it was handed the list.
 *
 * Three things keep the UI calm: a 300 ms debounce per project, so a `git
 * checkout` touching forty files causes one rescan; echo suppression, so the
 * app never reacts to its own saves; and a hard skip of the temp and `.bak`
 * files a save leaves behind.
 */

/** How long changes are coalesced before a `scan:changed` goes out. */
export const WATCH_DEBOUNCE_MS = 300;

/** How deep below a watched root chokidar descends (skills nest a little). */
const WATCH_DEPTH = 6;

export type WatchManagerOptions = {
  /** Called once per debounce window, per affected project. */
  onChange: (event: ScanChangedEvent) => void;
  /** Home folder holding `~/.claude` and `~/.codex`. Injectable for tests. */
  home?: string;
  debounceMs?: number;
  /** Forces chokidar's polling backend; tests use it, the app does not. */
  usePolling?: boolean;
};

/** The names, directly under a project root, that a scan reads. */
export const WATCHED_ROOT_ENTRIES = [
  CLAUDE_DIR,
  CODEX_DIR,
  CLAUDE_MCP_FILE,
  CLAUDE_INSTRUCTIONS,
  CODEX_INSTRUCTIONS,
] as const;

/** The narrow set of project paths a scan actually reads. */
export function projectWatchPaths(projectRoot: string): string[] {
  return WATCHED_ROOT_ENTRIES.map((name) => path.join(projectRoot, name));
}

/**
 * `true` when `target` is one of those names sitting directly in the root.
 *
 * chokidar only ever watches paths that exist when it is handed them, and
 * never adopts one that appears later. So a `CLAUDE.md` created after the
 * project was opened — by AMOS's own "Create CLAUDE.md", or by the user in
 * another editor — would stay invisible until the app restarted. A second,
 * flat watcher on the project root itself closes that hole, and this predicate
 * is what keeps it from reporting the rest of somebody's repository.
 */
export function isWatchedRootEntry(projectRoot: string, target: string): boolean {
  if (path.dirname(target) !== projectRoot) return false;
  return (WATCHED_ROOT_ENTRIES as readonly string[]).includes(path.basename(target));
}

/** The global capability roots, shared by every open project. */
export function globalWatchPaths(home: string): string[] {
  return [path.join(home, CLAUDE_DIR), path.join(home, CODEX_DIR), path.join(home, ".claude.json")];
}

/**
 * Paths a watcher must never report: the sibling temp file and the `.bak` an
 * atomic save creates, and the two folders no scan ever walks.
 */
export function isIgnoredWatchPath(target: string): boolean {
  const base = path.basename(target);
  if (base === "node_modules" || base === ".git") return true;
  if (base.endsWith(".bak")) return true;
  return /\.tmp\.\d+$/.test(base);
}

export class WatchManager {
  private readonly options: Required<Omit<WatchManagerOptions, "onChange">> & {
    onChange: (event: ScanChangedEvent) => void;
  };

  /** Project id → its watchers: the scan roots, plus the flat root watcher. */
  private readonly projects = new Map<string, FSWatcher[]>();
  /** Project id → watcher over files a scan found outside the fixed roots. */
  private readonly extras = new Map<string, { watcher: FSWatcher; paths: Set<string> }>();
  /** Project id → pending debounce timer. */
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Shared watcher on `~/.claude` and `~/.codex`, created with the first project. */
  private globalWatcher: FSWatcher | null = null;
  private closed = false;

  constructor(options: WatchManagerOptions) {
    this.options = {
      onChange: options.onChange,
      home: options.home ?? os.homedir(),
      debounceMs: options.debounceMs ?? WATCH_DEBOUNCE_MS,
      usePolling: options.usePolling ?? false,
    };
  }

  /** Watch one project. Watching an already-watched project is a no-op. */
  watch(projectId: string, projectRoot: string): void {
    if (this.closed || this.projects.has(projectId)) return;
    const root = path.resolve(projectRoot);
    const onEvent = () => this.schedule(projectId);
    this.projects.set(projectId, [
      this.createWatcher(projectWatchPaths(root), onEvent),
      // Flat, and filtered down to the handful of names a scan reads: this one
      // is here to notice those names *appearing*, not to watch the project.
      this.createWatcher([root], onEvent, {
        depth: 0,
        ignored: (target: string) =>
          target !== root && (isIgnoredWatchPath(target) || !isWatchedRootEntry(root, target)),
      }),
    ]);
    this.ensureGlobalWatcher();
  }

  /**
   * Watch the exact files a scan discovered outside the fixed root names —
   * nested `AGENTS.md` files, in practice. Called with each scan's findings,
   * it diffs against what is already watched, so repeated scans are cheap.
   *
   * This only covers files a scan has already seen: a nested file *created*
   * later is picked up at the next scan, not the moment it appears — watching
   * for its appearance would mean watching the whole tree, which the fixed
   * roots deliberately avoid.
   */
  setExtraFiles(projectId: string, files: string[]): void {
    if (this.closed || !this.projects.has(projectId)) return;
    const next = new Set(files.map((file) => path.resolve(file)));
    const entry = this.extras.get(projectId);
    if (!entry) {
      if (next.size === 0) return;
      this.extras.set(projectId, {
        watcher: this.createWatcher([...next], () => this.schedule(projectId), { depth: 0 }),
        paths: next,
      });
      return;
    }
    const added = [...next].filter((file) => !entry.paths.has(file));
    const removed = [...entry.paths].filter((file) => !next.has(file));
    if (added.length > 0) entry.watcher.add(added);
    if (removed.length > 0) entry.watcher.unwatch(removed);
    entry.paths = next;
  }

  /** Stop watching one project, and the global roots once none are left. */
  async unwatch(projectId: string): Promise<void> {
    const watchers = this.projects.get(projectId) ?? [];
    const extra = this.extras.get(projectId);
    if (extra) watchers.push(extra.watcher);
    this.projects.delete(projectId);
    this.extras.delete(projectId);
    this.cancel(projectId);
    await Promise.all(watchers.map((w) => w.close().catch(() => undefined)));
    if (this.projects.size === 0) await this.closeGlobalWatcher();
  }

  /** Ids of the projects currently watched. */
  watched(): string[] {
    return [...this.projects.keys()];
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    for (const id of [...this.timers.keys()]) this.cancel(id);
    const watchers = [
      ...[...this.projects.values()].flat(),
      ...[...this.extras.values()].map((entry) => entry.watcher),
    ];
    this.projects.clear();
    this.extras.clear();
    await Promise.all(watchers.map((w) => w.close().catch(() => undefined)));
    await this.closeGlobalWatcher();
  }

  // ------------------------------------------------------------------ internals

  private createWatcher(
    paths: string[],
    onEvent: () => void,
    overrides: { depth?: number; ignored?: (target: string) => boolean } = {},
  ): FSWatcher {
    const watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: overrides.depth ?? WATCH_DEPTH,
      usePolling: this.options.usePolling,
      interval: this.options.usePolling ? 80 : undefined,
      ignored: overrides.ignored ?? ((target: string) => isIgnoredWatchPath(target)),
    });
    // A watched root that does not exist yet, or that disappears, is normal —
    // most projects have only one of `.claude` and `.codex`.
    watcher.on("error", () => undefined);
    for (const event of ["add", "change", "unlink", "addDir", "unlinkDir"] as const) {
      watcher.on(event, (target: string) => {
        if (wasSelfWrite(target)) return;
        onEvent();
      });
    }
    return watcher;
  }

  private ensureGlobalWatcher(): void {
    if (this.globalWatcher || this.projects.size === 0) return;
    // One change under `~/.claude` affects every open project, so the shared
    // watcher fans its events out to all of them.
    this.globalWatcher = this.createWatcher(globalWatchPaths(this.options.home), () => {
      for (const projectId of this.projects.keys()) this.schedule(projectId);
    });
  }

  private async closeGlobalWatcher(): Promise<void> {
    const watcher = this.globalWatcher;
    this.globalWatcher = null;
    if (watcher) await watcher.close().catch(() => undefined);
  }

  private schedule(projectId: string): void {
    if (this.closed) return;
    this.cancel(projectId);
    const timer = setTimeout(() => {
      this.timers.delete(projectId);
      if (this.closed || !this.projects.has(projectId)) return;
      this.options.onChange({ projectId, at: new Date().toISOString() });
    }, this.options.debounceMs);
    // Never hold the process open just to deliver a rescan hint.
    timer.unref?.();
    this.timers.set(projectId, timer);
  }

  private cancel(projectId: string): void {
    const timer = this.timers.get(projectId);
    if (timer) clearTimeout(timer);
    this.timers.delete(projectId);
  }
}
