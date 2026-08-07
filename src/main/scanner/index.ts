import os from "node:os";
import path from "node:path";
import type { CapabilityItem, ProjectScan } from "../../shared/capabilities.js";
import { scanClaudeGlobal, scanClaudeProject } from "./claude.js";
import { scanCodexGlobal, scanCodexProject } from "./codex.js";
import { isDirectory, mergeChunks } from "./fsutil.js";

export type ScanOptions = {
  /**
   * Home directory the global scan reads from. Injectable so tests never
   * depend on the machine's real `~/.claude` and `~/.codex`.
   */
  home?: string;
  /** Set to `false` to scan the project folder only. Defaults to `true`. */
  includeGlobal?: boolean;
};

/**
 * Scan a project folder for everything AMOS manages: agents, skills and MCP
 * servers, on both the Claude and the Codex side, plus the global (home)
 * capabilities that also apply inside that project.
 *
 * The result is never cached on disk — the filesystem is the source of truth,
 * and this runs again on every `scan:project` call.
 */
export async function scanProject(
  projectPath: string,
  options: ScanOptions = {},
): Promise<ProjectScan> {
  const root = path.resolve(projectPath);
  const home = options.home ?? os.homedir();
  const includeGlobal = options.includeGlobal !== false;

  const scan: ProjectScan = {
    projectPath: root,
    scannedAt: new Date().toISOString(),
    items: [],
    instructions: [],
    errors: [],
  };

  if (!(await isDirectory(root))) {
    scan.errors.push({ path: root, message: "This folder does not exist any more." });
    return scan;
  }

  const chunks = [await scanClaudeProject(root), await scanCodexProject(root)];
  if (includeGlobal) {
    chunks.push(await scanClaudeGlobal(home), await scanCodexGlobal(home));
  }

  const merged = mergeChunks(chunks);
  scan.items = sortItems(merged.items);
  scan.instructions = merged.instructions;
  scan.errors = merged.errors;
  return scan;
}

/** Display order: project first, then kind, ecosystem and name. */
function sortItems(items: CapabilityItem[]): CapabilityItem[] {
  const kindRank = { agent: 0, mcp: 1, skill: 2 } as const;
  return [...items].sort(
    (a, b) =>
      Number(a.scope === "global") - Number(b.scope === "global") ||
      kindRank[a.kind] - kindRank[b.kind] ||
      a.ecosystem.localeCompare(b.ecosystem) ||
      a.name.localeCompare(b.name),
  );
}

export { scanClaudeGlobal, scanClaudeProject } from "./claude.js";
export { scanCodexGlobal, scanCodexProject } from "./codex.js";
