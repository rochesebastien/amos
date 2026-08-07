import matter from "gray-matter";
import { z } from "zod";
import type { AgentData, McpData, McpTransport } from "../../shared/capabilities.js";

/**
 * Parsers for the four file formats AMOS reads: YAML frontmatter (agents and
 * skills), JSON (`.mcp.json`, `~/.claude.json`) and TOML (`config.toml`).
 *
 * Every schema is *loose*: unknown keys are kept verbatim so that the writers
 * of the next phase can round-trip a file without dropping whatever the user
 * (or another tool) put in it.
 */

// ------------------------------------------------------------------ schemas

/** Frontmatter of an agent `.md` or of a `SKILL.md`. */
export const FrontmatterSchema = z.looseObject({
  name: z.string().optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  tools: z.union([z.string(), z.array(z.string())]).optional(),
});

const Stringish = z.union([z.string(), z.number(), z.boolean()]);

/** One MCP server entry, in either `.mcp.json` or `[mcp_servers.*]`. */
export const McpServerSchema = z.looseObject({
  type: z.string().optional(),
  transport: z.string().optional(),
  command: z.string().optional(),
  args: z.array(Stringish).optional(),
  env: z.record(z.string(), Stringish).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), Stringish).optional(),
});

/** A file whose `mcpServers` object holds the entries (Claude side). */
export const McpServersFileSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
});

/** A `config.toml` whose `mcp_servers` table holds the entries (Codex side). */
export const CodexConfigSchema = z.looseObject({
  mcp_servers: z.record(z.string(), z.unknown()).optional(),
});

/** Compact one-line rendering of a zod failure, for the "broken" badge. */
export function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid document";
  const at = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${at}${issue.message}`;
}

// -------------------------------------------------------------- frontmatter

export type ParsedMarkdown = {
  /** Best-effort payload; `null` only when the YAML itself is unparseable. */
  frontmatter: Record<string, unknown> | null;
  body: string;
  /** Set when the YAML failed to parse or a known key had the wrong type. */
  error?: string;
};

/**
 * Split a markdown file into frontmatter + body. A YAML syntax error is
 * reported rather than thrown; a *type* error on a known key still yields the
 * raw frontmatter, so the editor can show — and fix — what is there.
 */
export function parseMarkdown(source: string): ParsedMarkdown {
  let data: Record<string, unknown>;
  let body: string;
  try {
    // The options object is what disables gray-matter's module-level cache.
    // That cache is keyed by file *content* and is populated before parsing,
    // so a file whose YAML throws leaves a half-built entry behind that later
    // calls return silently — and it would grow unbounded as AMOS rescans.
    const file = matter(source, {});
    data = (file.data ?? {}) as Record<string, unknown>;
    body = file.content.replace(/^\n+/, "");
  } catch (err) {
    return {
      frontmatter: null,
      body: source,
      error: err instanceof Error ? err.message.split("\n")[0]! : String(err),
    };
  }

  const parsed = FrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    return { frontmatter: data, body, error: formatZodError(parsed.error) };
  }
  return { frontmatter: parsed.data as Record<string, unknown>, body };
}

/** Turn parsed frontmatter into the agent payload the UI renders. */
export function toAgentData(frontmatter: Record<string, unknown>, body: string): AgentData {
  return {
    description: stringOrNull(frontmatter.description),
    model: stringOrNull(frontmatter.model),
    tools: toolList(frontmatter.tools),
    frontmatter,
    body,
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** `tools` is written either as a YAML list or as a comma-separated string. */
export function toolList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const tools = value.filter((v): v is string => typeof v === "string");
    return tools.length ? tools : null;
  }
  if (typeof value === "string") {
    const tools = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return tools.length ? tools : null;
  }
  return null;
}

// ---------------------------------------------------------------- mcp entry

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v == null || typeof v === "object") continue;
    out[k] = String(v);
  }
  return out;
}

/**
 * Resolve the transport of an MCP entry.
 *
 * An explicit `type` (Claude) or `transport` key wins. Without one the entry
 * is stdio — that is the documented `.mcp.json` default — except when it
 * carries only a `url`, which can only describe a remote server.
 */
export function resolveTransport(raw: Record<string, unknown>): McpTransport {
  const declared = typeof raw.type === "string" ? raw.type : raw.transport;
  const type = typeof declared === "string" ? declared.trim().toLowerCase() : "";
  if (type === "stdio") return "stdio";
  if (type === "sse") return "sse";
  if (type === "ws" || type === "websocket") return "ws";
  if (type === "http" || type === "streamable-http" || type === "streamable_http") return "http";

  const hasCommand = typeof raw.command === "string" && raw.command.trim() !== "";
  const hasUrl = typeof raw.url === "string" && raw.url.trim() !== "";
  if (!hasCommand && hasUrl) return "http";
  return "stdio";
}

export type ParsedMcp = { data: McpData | null; error?: string };

/** Validate one MCP entry and shape it for the UI. */
export function parseMcpEntry(entry: unknown): ParsedMcp {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { data: null, error: "MCP server entry must be an object" };
  }
  const raw = entry as Record<string, unknown>;
  const parsed = McpServerSchema.safeParse(raw);
  const data: McpData = {
    transport: resolveTransport(raw),
    command: stringOrNull(raw.command),
    args: Array.isArray(raw.args)
      ? raw.args.filter((a) => a != null && typeof a !== "object").map((a) => String(a))
      : [],
    env: stringMap(raw.env),
    url: stringOrNull(raw.url),
    headers: stringMap(raw.headers),
    raw,
  };
  if (!parsed.success) return { data, error: formatZodError(parsed.error) };
  return { data };
}
