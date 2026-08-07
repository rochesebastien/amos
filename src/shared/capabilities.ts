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
};

/** A directory or file the scanner could not read at all. */
export type ScanError = {
  /** Absolute path of the thing that failed. */
  path: string;
  message: string;
};

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
