/**
 * The unified capability model: what AMOS finds when it scans a project.
 *
 * The filesystem is the single source of truth — nothing here is ever
 * persisted in the database. This module is bundled into the sandboxed
 * renderer as well, so it must stay free of Node and Electron imports.
 */

/** Which CLI ecosystem a capability belongs to. */
export type Ecosystem = "claude" | "codex";

/** Where a capability was found: inside the project, or in the user's home. */
export type Scope = "project" | "global";

/** The three kinds of capability AMOS manages. */
export type CapabilityKind = "agent" | "skill" | "mcp";

export const CAPABILITY_KINDS = ["agent", "skill", "mcp"] as const;
export const ECOSYSTEMS = ["claude", "codex"] as const;

// ------------------------------------------------------------------- payloads

/** A sub-agent declared by a markdown file with YAML frontmatter. */
export type AgentData = {
  /** `description` from the frontmatter, when present. */
  description: string | null;
  /** `model` from the frontmatter, when present. */
  model: string | null;
  /** `tools`, normalised from a comma-separated string or a list. */
  tools: string[] | null;
  /** The full frontmatter, unknown keys included — writes must not lose them. */
  frontmatter: Record<string, unknown>;
  /** Everything after the frontmatter block. */
  body: string;
};

/** A file inside a skill folder, relative to that folder. */
export type SkillFile = {
  /** Path relative to the skill folder, POSIX separators. */
  relativePath: string;
  /** Size in bytes. */
  bytes: number;
};

/** A skill: a folder holding a `SKILL.md` plus any supporting files. */
export type SkillData = {
  description: string | null;
  /** The full `SKILL.md` frontmatter, unknown keys included. */
  frontmatter: Record<string, unknown>;
  /** The `SKILL.md` body. */
  body: string;
  /** Absolute path of the skill folder. */
  directory: string;
  /** Every file in the folder (including `SKILL.md`), depth-limited. */
  files: SkillFile[];
};

/** How a client talks to an MCP server. */
export type McpTransport = "stdio" | "http" | "sse" | "ws";

export const MCP_TRANSPORTS = ["stdio", "http", "sse", "ws"] as const;

/** One entry of `.mcp.json` / `~/.claude.json` / `[mcp_servers.*]`. */
export type McpData = {
  transport: McpTransport;
  /** stdio servers: the executable. */
  command: string | null;
  /** stdio servers: arguments passed to the executable. */
  args: string[];
  /** stdio servers: extra environment variables. */
  env: Record<string, string>;
  /** http / sse / ws servers: the endpoint. */
  url: string | null;
  /** http / sse / ws servers: extra request headers. */
  headers: Record<string, string>;
  /** The entry exactly as it sits in the file, unknown keys included. */
  raw: Record<string, unknown>;
};

// --------------------------------------------------------------------- items

type CapabilityBase = {
  /** Stable hash of `kind:sourceFile:name` — the routing id of the item. */
  id: string;
  ecosystem: Ecosystem;
  scope: Scope;
  /** Display name (agent/skill folder name, MCP server key). */
  name: string;
  /**
   * What the item *is* on disk: the agent file, the skill folder, or — for an
   * MCP server, which has no file of its own — its declaring config file.
   */
  path: string;
  /** The file AMOS parsed to find this item, and the one it will write back. */
  sourceFile: string;
  /**
   * `mtimeMs` of `sourceFile` at scan time. Editors send it back as
   * `expectedMtimeMs` so a save can refuse to clobber a file another tool
   * touched in the meantime. `0` when the file could not be stat'ed.
   */
  mtimeMs: number;
  /**
   * Set when the declaring file could not be parsed. `data` is then `null`
   * and the UI shows the item as broken instead of hiding it.
   */
  parseError?: string;
};

export type AgentItem = CapabilityBase & { kind: "agent"; data: AgentData | null };
export type SkillItem = CapabilityBase & { kind: "skill"; data: SkillData | null };
export type McpItem = CapabilityBase & { kind: "mcp"; data: McpData | null };

export type CapabilityItem = AgentItem | SkillItem | McpItem;

/** A `CLAUDE.md` / `AGENTS.md` instruction file found during the scan. */
export type InstructionFile = {
  id: string;
  ecosystem: Ecosystem;
  scope: Scope;
  /** Basename, e.g. `CLAUDE.md`. */
  name: string;
  /** Absolute path. */
  path: string;
  /** Path relative to the project root; absolute for global files. */
  relativePath: string;
  bytes: number;
  /**
   * `mtimeMs` of the file at scan time. The instruction editor compares it
   * with the mtime it read the bytes at, so a change made by another tool
   * surfaces through the ordinary watch → rescan flow. `0` when the file could
   * not be stat'ed.
   */
  mtimeMs: number;
};

/**
 * The instruction files AMOS offers to create at the root of a project — one
 * per ecosystem, exactly where each CLI looks for it.
 */
export const ROOT_INSTRUCTION_FILES = [
  { ecosystem: "claude", name: "CLAUDE.md" },
  { ecosystem: "codex", name: "AGENTS.md" },
] as const satisfies readonly { ecosystem: Ecosystem; name: string }[];

/** `true` when the project root already carries that instruction file. */
export function hasRootInstruction(instructions: InstructionFile[], name: string): boolean {
  return instructions.some((f) => f.scope === "project" && f.relativePath === name);
}

/** The scanned instruction file sitting at the project root, if any. */
export function findRootInstruction(
  instructions: InstructionFile[],
  name: string,
): InstructionFile | undefined {
  return instructions.find((f) => f.scope === "project" && f.relativePath === name);
}

/** A directory or file the scanner could not read at all. */
export type ScanError = {
  /** Absolute path of the thing that failed. */
  path: string;
  message: string;
};

/**
 * Where a *new* capability of a given ecosystem and scope has to be written.
 *
 * The renderer has no filesystem and no `os.homedir()`, so the scanner hands
 * it the four conventional locations of each ecosystem × scope pair. This is
 * what the "new agent / new skill / new MCP server" forms build paths from.
 */
export type CapabilityTarget = {
  ecosystem: Ecosystem;
  scope: Scope;
  /** Project folder for `project` scope, home folder for `global` scope. */
  root: string;
  /** Folder holding agent `.md` files — `null` for Codex, which has none. */
  agentsDir: string | null;
  /** Folder holding `<name>/SKILL.md` skill folders. */
  skillsDir: string;
  /** Config file declaring the MCP servers of this ecosystem × scope. */
  mcpFile: string;
  /** How that config file is encoded. */
  mcpFormat: McpFormat;
};

/** Encoding of an MCP config file: `.mcp.json` vs `config.toml`. */
export type McpFormat = "json" | "toml";

/** Everything one `scan:project` call returns. */
export type ProjectScan = {
  /** Absolute path the scan ran against. */
  projectPath: string;
  /** ISO-8601 timestamp of the scan. */
  scannedAt: string;
  items: CapabilityItem[];
  instructions: InstructionFile[];
  /** Unreadable paths — surfaced, never swallowed. */
  errors: ScanError[];
  /** Where to create new capabilities, one entry per ecosystem × scope. */
  targets: CapabilityTarget[];
};

// ----------------------------------------------------------------------- ids

/**
 * FNV-1a (32 bit, twice with different offsets) rendered as 16 hex chars.
 * A dependency-free, Node-free hash: ids must be computable on both sides of
 * the bridge and stay stable across runs.
 */
function hash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** The id of a capability: a hash of `kind:sourceFile:name`. */
export function capabilityId(kind: CapabilityKind, sourceFile: string, name: string): string {
  return hash(`${kind}:${sourceFile}:${name}`);
}

/** The id of an instruction file: a hash of `instruction:path`. */
export function instructionId(filePath: string): string {
  return hash(`instruction:${filePath}`);
}

// ------------------------------------------------------------------- helpers

/** `true` when the item failed to parse (shown with a "broken" badge). */
export function isBroken(item: CapabilityItem): boolean {
  return item.parseError != null;
}

/** Count of items matching an optional kind / ecosystem / scope filter. */
export function countItems(
  items: CapabilityItem[],
  filter: { kind?: CapabilityKind; ecosystem?: Ecosystem; scope?: Scope } = {},
): number {
  return items.filter(
    (i) =>
      (filter.kind === undefined || i.kind === filter.kind) &&
      (filter.ecosystem === undefined || i.ecosystem === filter.ecosystem) &&
      (filter.scope === undefined || i.scope === filter.scope),
  ).length;
}

/** The target for one ecosystem × scope pair, or `undefined` when not scanned. */
export function findTarget(
  targets: CapabilityTarget[],
  ecosystem: Ecosystem,
  scope: Scope,
): CapabilityTarget | undefined {
  return targets.find((t) => t.ecosystem === ecosystem && t.scope === scope);
}

/**
 * Join a folder and a child with `/`. The renderer has no `path` module, and
 * every path AMOS hands it is already absolute and native — appending with a
 * forward slash is understood by both Windows and POSIX.
 */
export function joinPath(dir: string, ...parts: string[]): string {
  return [dir.replace(/[/\\]+$/, ""), ...parts].join("/");
}

/**
 * Names AMOS is willing to create files and folders from: no separators, no
 * dot-prefix, no traversal. Rejecting here keeps the "new capability" forms
 * from ever proposing a path the main process would refuse.
 */
export function isSafeName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..") && name.length <= 100;
}

/** Items of one kind, ordered for display: project before global, then name. */
export function itemsOfKind(items: CapabilityItem[], kind: CapabilityKind): CapabilityItem[] {
  return items
    .filter((i) => i.kind === kind)
    .sort(
      (a, b) =>
        Number(a.scope === "global") - Number(b.scope === "global") ||
        a.ecosystem.localeCompare(b.ecosystem) ||
        a.name.localeCompare(b.name),
    );
}
