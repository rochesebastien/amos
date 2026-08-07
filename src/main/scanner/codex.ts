import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { collectInstruction, collectMcpServers, collectSkills, pushBrokenFile } from "./collect.js";
import { newChunk, readTextFile, walkFiles, type ScanChunk } from "./fsutil.js";
import { CodexConfigSchema, formatZodError } from "./schemas.js";

/**
 * The Codex side of a scan.
 *
 * Project: `AGENTS.md` at the root *and* nested ones (Codex reads the closest
 * one to the file it is editing), `.codex/skills/<name>/SKILL.md` and the
 * `[mcp_servers.*]` tables of `.codex/config.toml`.
 * Global: `~/.codex/config.toml`, `~/.codex/skills`, `~/.codex/AGENTS.md`.
 */

export const CODEX_DIR = ".codex";
export const CODEX_CONFIG_FILE = "config.toml";
export const CODEX_INSTRUCTIONS = "AGENTS.md";

/** How many folder levels below the project root nested `AGENTS.md` are found. */
export const AGENTS_MAX_DEPTH = 4;

export async function scanCodexProject(projectRoot: string): Promise<ScanChunk> {
  const chunk = newChunk();
  const origin = { ecosystem: "codex", scope: "project" } as const;
  const codexDir = path.join(projectRoot, CODEX_DIR);

  await collectSkills(path.join(codexDir, "skills"), origin, chunk);
  await collectCodexConfig(path.join(codexDir, CODEX_CONFIG_FILE), origin, chunk);
  await collectNestedInstructions(projectRoot, chunk);

  return chunk;
}

export async function scanCodexGlobal(home: string): Promise<ScanChunk> {
  const chunk = newChunk();
  const origin = { ecosystem: "codex", scope: "global" } as const;
  const codexDir = path.join(home, CODEX_DIR);

  await collectSkills(path.join(codexDir, "skills"), origin, chunk);
  await collectCodexConfig(path.join(codexDir, CODEX_CONFIG_FILE), origin, chunk);
  await collectInstruction(path.join(codexDir, CODEX_INSTRUCTIONS), origin, chunk);

  return chunk;
}

/**
 * Walk the project for `AGENTS.md`, root one included. `node_modules`, `.git`
 * and every other dot-directory are skipped, and the walk stops four folders
 * down — deep enough for a monorepo package, cheap enough to run on save.
 */
async function collectNestedInstructions(projectRoot: string, chunk: ScanChunk): Promise<void> {
  const origin = { ecosystem: "codex", scope: "project" } as const;
  const files = await walkFiles(projectRoot, { maxDepth: AGENTS_MAX_DEPTH }, chunk);
  const found = files
    .filter((f) => path.basename(f.path) === CODEX_INSTRUCTIONS)
    .sort((a, b) => a.depth - b.depth || a.relativePath.localeCompare(b.relativePath));
  for (const file of found) {
    await collectInstruction(file.path, origin, chunk, projectRoot);
  }
}

/**
 * Read a `config.toml` and collect its `[mcp_servers.*]` tables. Invalid TOML
 * becomes one broken item rather than an empty, silent result.
 */
async function collectCodexConfig(
  filePath: string,
  origin: { ecosystem: "codex"; scope: "project" | "global" },
  chunk: ScanChunk,
): Promise<void> {
  const source = await readTextFile(filePath, chunk);
  if (source == null) return;

  let toml: unknown;
  try {
    toml = parseToml(source);
  } catch (err) {
    await pushBrokenFile(filePath, origin, chunk, err instanceof Error ? err.message : String(err));
    return;
  }

  const parsed = CodexConfigSchema.safeParse(toml);
  if (!parsed.success) {
    await pushBrokenFile(filePath, origin, chunk, formatZodError(parsed.error));
    return;
  }

  const servers = parsed.data.mcp_servers;
  if (!servers) return;
  await collectMcpServers(filePath, servers, origin, chunk);
}
