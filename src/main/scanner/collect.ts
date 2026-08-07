import path from "node:path";
import {
  capabilityId,
  instructionId,
  type Ecosystem,
  type Scope,
  type SkillFile,
} from "../../shared/capabilities.js";
import {
  fileMtimeMs,
  fileSize,
  isFile,
  readDirectory,
  readTextFile,
  toPosix,
  walkFiles,
  type ScanChunk,
} from "./fsutil.js";
import { parseMarkdown, parseMcpEntry, toAgentData } from "./schemas.js";

/**
 * Ecosystem-agnostic collectors. `claude.ts` and `codex.ts` only decide
 * *which* paths to look at; the shape of an agent folder, a skill folder or an
 * `mcpServers` map is identical on both sides.
 */

type Origin = { ecosystem: Ecosystem; scope: Scope };

/** How deep agent folders may nest below `<root>/agents`. */
const AGENT_MAX_DEPTH = 3;
/** How deep a skill folder is listed. */
const SKILL_FILES_MAX_DEPTH = 3;

/**
 * Every `*.md` under an `agents/` folder. The agent's name is its
 * frontmatter `name` when it declares one, and its filename otherwise —
 * the same resolution the CLIs use.
 */
export async function collectAgents(
  agentsDir: string,
  origin: Origin,
  chunk: ScanChunk,
): Promise<void> {
  const files = await walkFiles(agentsDir, { maxDepth: AGENT_MAX_DEPTH }, chunk);
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".md")) continue;
    const fallbackName = path.basename(file.path).replace(/\.md$/i, "");
    const mtimeMs = await fileMtimeMs(file.path);
    const source = await readTextFile(file.path, chunk);
    if (source == null) {
      chunk.items.push({
        kind: "agent",
        id: capabilityId("agent", file.path, fallbackName),
        ...origin,
        name: fallbackName,
        path: file.path,
        sourceFile: file.path,
        mtimeMs,
        data: null,
        parseError: "File could not be read",
      });
      continue;
    }

    const parsed = parseMarkdown(source);
    const frontmatter = parsed.frontmatter ?? {};
    const declared = frontmatter.name;
    const name = typeof declared === "string" && declared.trim() ? declared.trim() : fallbackName;
    chunk.items.push({
      kind: "agent",
      id: capabilityId("agent", file.path, name),
      ...origin,
      name,
      path: file.path,
      sourceFile: file.path,
      mtimeMs,
      data: parsed.frontmatter ? toAgentData(frontmatter, parsed.body) : null,
      ...(parsed.error ? { parseError: parsed.error } : {}),
    });
  }
}

/**
 * Every `<skills>/<name>/SKILL.md`. The folder name is the skill's name: it is
 * what the CLIs address, whatever the frontmatter claims.
 */
export async function collectSkills(
  skillsDir: string,
  origin: Origin,
  chunk: ScanChunk,
): Promise<void> {
  const entries = await readDirectory(skillsDir, chunk);
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith(".")) continue;
    const directory = path.join(skillsDir, entry.name);
    const sourceFile = path.join(directory, "SKILL.md");
    if (!(await isFile(sourceFile))) continue;

    const id = capabilityId("skill", sourceFile, entry.name);
    const mtimeMs = await fileMtimeMs(sourceFile);
    const source = await readTextFile(sourceFile, chunk);
    const files = await listSkillFiles(directory, chunk);

    if (source == null) {
      chunk.items.push({
        kind: "skill",
        id,
        ...origin,
        name: entry.name,
        path: directory,
        sourceFile,
        mtimeMs,
        data: null,
        parseError: "SKILL.md could not be read",
      });
      continue;
    }

    const parsed = parseMarkdown(source);
    const frontmatter = parsed.frontmatter ?? {};
    chunk.items.push({
      kind: "skill",
      id,
      ...origin,
      name: entry.name,
      path: directory,
      sourceFile,
      mtimeMs,
      data: parsed.frontmatter
        ? {
            description:
              typeof frontmatter.description === "string" ? frontmatter.description : null,
            frontmatter,
            body: parsed.body,
            directory,
            files,
          }
        : null,
      ...(parsed.error ? { parseError: parsed.error } : {}),
    });
  }
}

async function listSkillFiles(directory: string, chunk: ScanChunk): Promise<SkillFile[]> {
  const walked = await walkFiles(directory, { maxDepth: SKILL_FILES_MAX_DEPTH }, chunk);
  const files: SkillFile[] = [];
  for (const file of walked) {
    files.push({ relativePath: file.relativePath, bytes: await fileSize(file.path) });
  }
  // `SKILL.md` is the entry point, so it leads the list; the rest is alphabetical.
  return files.sort(
    (a, b) =>
      Number(a.relativePath !== "SKILL.md") - Number(b.relativePath !== "SKILL.md") ||
      a.relativePath.localeCompare(b.relativePath),
  );
}

/**
 * Every entry of an already-parsed `mcpServers` / `mcp_servers` map. MCP
 * servers have no file of their own: `path` and `sourceFile` are both the
 * config file that declares them.
 */
export async function collectMcpServers(
  sourceFile: string,
  servers: Record<string, unknown>,
  origin: Origin,
  chunk: ScanChunk,
): Promise<void> {
  const mtimeMs = await fileMtimeMs(sourceFile);
  for (const name of Object.keys(servers).sort()) {
    const parsed = parseMcpEntry(servers[name]);
    chunk.items.push({
      kind: "mcp",
      id: capabilityId("mcp", sourceFile, name),
      ...origin,
      name,
      path: sourceFile,
      sourceFile,
      mtimeMs,
      data: parsed.data,
      ...(parsed.error ? { parseError: parsed.error } : {}),
    });
  }
}

/**
 * A config file that could not be parsed at all (bad JSON, bad TOML) shows up
 * as a single broken MCP item named after the file, so the UI can point at it
 * instead of silently showing nothing.
 */
export async function pushBrokenFile(
  filePath: string,
  origin: Origin,
  chunk: ScanChunk,
  message: string,
): Promise<void> {
  const name = path.basename(filePath);
  chunk.items.push({
    kind: "mcp",
    id: capabilityId("mcp", filePath, name),
    ...origin,
    name,
    path: filePath,
    sourceFile: filePath,
    mtimeMs: await fileMtimeMs(filePath),
    data: null,
    parseError: message,
  });
}

/**
 * Record a `CLAUDE.md` / `AGENTS.md`. `relativeTo` is the project root for
 * project files; global files keep their absolute path.
 */
export async function collectInstruction(
  filePath: string,
  origin: Origin,
  chunk: ScanChunk,
  relativeTo?: string,
): Promise<void> {
  if (!(await isFile(filePath))) return;
  chunk.instructions.push({
    id: instructionId(filePath),
    ...origin,
    name: path.basename(filePath),
    path: filePath,
    relativePath: relativeTo ? toPosix(path.relative(relativeTo, filePath)) : filePath,
    bytes: await fileSize(filePath),
    mtimeMs: await fileMtimeMs(filePath),
  });
}
