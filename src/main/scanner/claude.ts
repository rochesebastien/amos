import path from "node:path";
import {
  collectAgents,
  collectInstruction,
  collectMcpServers,
  collectSkills,
  pushBrokenFile,
} from "./collect.js";
import { newChunk, readTextFile, type ScanChunk } from "./fsutil.js";
import { formatZodError, McpServersFileSchema } from "./schemas.js";

/**
 * The Claude side of a scan.
 *
 * Project: `.claude/agents/**\/*.md`, `.claude/skills/<name>/SKILL.md`,
 * `.mcp.json` and the root `CLAUDE.md`.
 * Global: `~/.claude/agents`, `~/.claude/skills`, `~/.claude/CLAUDE.md` and the
 * *top-level* `mcpServers` of `~/.claude.json` (that file also carries a
 * per-project section, which belongs to the project scope, not here).
 */

export const CLAUDE_DIR = ".claude";
export const CLAUDE_MCP_FILE = ".mcp.json";
export const CLAUDE_INSTRUCTIONS = "CLAUDE.md";

export async function scanClaudeProject(projectRoot: string): Promise<ScanChunk> {
  const chunk = newChunk();
  const origin = { ecosystem: "claude", scope: "project" } as const;
  const claudeDir = path.join(projectRoot, CLAUDE_DIR);

  await collectAgents(path.join(claudeDir, "agents"), origin, chunk);
  await collectSkills(path.join(claudeDir, "skills"), origin, chunk);
  await collectClaudeMcpFile(path.join(projectRoot, CLAUDE_MCP_FILE), origin, chunk);
  await collectInstruction(
    path.join(projectRoot, CLAUDE_INSTRUCTIONS),
    origin,
    chunk,
    projectRoot,
  );
  await collectInstruction(path.join(claudeDir, CLAUDE_INSTRUCTIONS), origin, chunk, projectRoot);

  return chunk;
}

export async function scanClaudeGlobal(home: string): Promise<ScanChunk> {
  const chunk = newChunk();
  const origin = { ecosystem: "claude", scope: "global" } as const;
  const claudeDir = path.join(home, CLAUDE_DIR);

  await collectAgents(path.join(claudeDir, "agents"), origin, chunk);
  await collectSkills(path.join(claudeDir, "skills"), origin, chunk);
  await collectClaudeMcpFile(path.join(home, ".claude.json"), origin, chunk);
  await collectInstruction(path.join(claudeDir, CLAUDE_INSTRUCTIONS), origin, chunk);

  return chunk;
}

/**
 * Read a JSON file holding an `mcpServers` object. A file that is not valid
 * JSON becomes a single broken MCP item named after the file, so the UI can
 * point at it instead of silently showing nothing.
 */
async function collectClaudeMcpFile(
  filePath: string,
  origin: { ecosystem: "claude"; scope: "project" | "global" },
  chunk: ScanChunk,
): Promise<void> {
  const source = await readTextFile(filePath, chunk);
  if (source == null) return;

  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (err) {
    pushBrokenFile(filePath, origin, chunk, err instanceof Error ? err.message : String(err));
    return;
  }

  const parsed = McpServersFileSchema.safeParse(json);
  if (!parsed.success) {
    pushBrokenFile(filePath, origin, chunk, formatZodError(parsed.error));
    return;
  }

  const servers = parsed.data.mcpServers;
  if (!servers) return;
  collectMcpServers(filePath, servers, origin, chunk);
}
