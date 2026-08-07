import os from "node:os";
import path from "node:path";
import type { CapabilityItem, CapabilityTarget, ProjectScan } from "../../shared/capabilities.js";
import { CLAUDE_DIR, CLAUDE_MCP_FILE, scanClaudeGlobal, scanClaudeProject } from "./claude.js";
import { CODEX_CONFIG_FILE, CODEX_DIR, scanCodexGlobal, scanCodexProject } from "./codex.js";
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
    targets: capabilityTargets(root, home, includeGlobal),
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

/**
 * Where a new agent / skill / MCP server of each ecosystem × scope has to go.
 *
 * These are conventions, not discoveries: the folders need not exist yet — the
 * first save creates them. Codex has no per-ecosystem agent folder (its agent
 * instructions live in `AGENTS.md` files), hence the `null`.
 */
export function capabilityTargets(
  projectRoot: string,
  home: string,
  includeGlobal = true,
): CapabilityTarget[] {
  const targets: CapabilityTarget[] = [
    {
      ecosystem: "claude",
      scope: "project",
      root: projectRoot,
      agentsDir: path.join(projectRoot, CLAUDE_DIR, "agents"),
      skillsDir: path.join(projectRoot, CLAUDE_DIR, "skills"),
      mcpFile: path.join(projectRoot, CLAUDE_MCP_FILE),
      mcpFormat: "json",
    },
    {
      ecosystem: "codex",
      scope: "project",
      root: projectRoot,
      agentsDir: null,
      skillsDir: path.join(projectRoot, CODEX_DIR, "skills"),
      mcpFile: path.join(projectRoot, CODEX_DIR, CODEX_CONFIG_FILE),
      mcpFormat: "toml",
    },
  ];

  if (includeGlobal) {
    targets.push(
      {
        ecosystem: "claude",
        scope: "global",
        root: home,
        agentsDir: path.join(home, CLAUDE_DIR, "agents"),
        skillsDir: path.join(home, CLAUDE_DIR, "skills"),
        // The global Claude servers live at the top level of `~/.claude.json`,
        // not in `~/.claude/`.
        mcpFile: path.join(home, ".claude.json"),
        mcpFormat: "json",
      },
      {
        ecosystem: "codex",
        scope: "global",
        root: home,
        agentsDir: null,
        skillsDir: path.join(home, CODEX_DIR, "skills"),
        mcpFile: path.join(home, CODEX_DIR, CODEX_CONFIG_FILE),
        mcpFormat: "toml",
      },
    );
  }

  return targets;
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
