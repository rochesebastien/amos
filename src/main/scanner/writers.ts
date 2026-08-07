import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { McpFormat } from "../../shared/capabilities.js";
import type { FrontmatterFields, McpFields } from "../../shared/ipc.js";
import { safeWriteFile, type SafeWriteResult } from "../services/safeWrite.js";

/**
 * The writing half of the scanner.
 *
 * The rule every function here obeys: *read the whole document, change the one
 * thing that was asked for, write the whole document back*. A `.mcp.json` is
 * never regenerated from AMOS's model of an MCP server — it is parsed, one key
 * of one entry is replaced, and it is serialised again. Unknown keys, other
 * servers and unrelated top-level settings therefore survive a save untouched.
 */

// ------------------------------------------------------------------ markdown

/**
 * Serialise frontmatter + body back into a markdown file. An empty
 * frontmatter yields a plain markdown file with no `---` block at all.
 */
export function serializeMarkdown(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value !== undefined) data[key] = value;
  }
  const content = body.replace(/\s+$/, "") + "\n";
  // The options object is what disables gray-matter's content-keyed cache —
  // the same reason `parseMarkdown` passes one. Never call this bare.
  return matter.stringify(content, data, {});
}

/**
 * Merge the form's fields into the frontmatter already on disk.
 *
 * A field absent from `fields` is left alone; a field set to `null` or to an
 * empty string/array is removed; anything else is written. `tools` keeps the
 * shape the file already used — a comma-separated string stays a string.
 */
export function applyFrontmatterFields(
  existing: Record<string, unknown>,
  fields: FrontmatterFields,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };

  const setString = (key: "name" | "description" | "model") => {
    if (!(key in fields)) return;
    const value = fields[key];
    if (value == null || value.trim() === "") delete out[key];
    else out[key] = value.trim();
  };
  setString("name");
  setString("description");
  setString("model");

  if ("tools" in fields) {
    const tools = fields.tools?.map((s) => s.trim()).filter(Boolean) ?? [];
    if (tools.length === 0) delete out.tools;
    else if (typeof existing.tools === "string") out.tools = tools.join(", ");
    else out.tools = tools;
  }

  return out;
}

export type WriteMarkdownInput = {
  /** Absolute path of the `.md` file. */
  filePath: string;
  fields: FrontmatterFields;
  body: string;
  /** `undefined` overwrites, a number checks the mtime, `null` demands a new file. */
  expectedMtimeMs?: number | null;
};

/**
 * Write an agent `.md`: re-read what is on disk, merge the known fields into
 * its frontmatter, replace the body, and save atomically.
 */
export async function writeAgent(input: WriteMarkdownInput): Promise<SafeWriteResult> {
  return await writeMarkdownDocument(input);
}

/** Write a skill's `SKILL.md`. Identical mechanics, named for its caller. */
export async function writeSkillMd(input: WriteMarkdownInput): Promise<SafeWriteResult> {
  return await writeMarkdownDocument(input);
}

async function writeMarkdownDocument(input: WriteMarkdownInput): Promise<SafeWriteResult> {
  const source = await readTextOrNull(input.filePath);
  const existing = source == null ? {} : readFrontmatter(source);
  const frontmatter = applyFrontmatterFields(existing, input.fields);
  return await safeWriteFile(input.filePath, serializeMarkdown(frontmatter, input.body), {
    expectedMtimeMs: input.expectedMtimeMs,
  });
}

/**
 * Frontmatter of a file we are about to rewrite. Unparseable YAML yields an
 * empty object: the user is replacing a broken header, and there is nothing
 * there worth preserving.
 */
function readFrontmatter(source: string): Record<string, unknown> {
  try {
    return (matter(source, {}).data ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ----------------------------------------------------------------- mcp entry

/** Which encoding a config file uses, from its extension. */
export function mcpFormatFor(filePath: string): McpFormat {
  return path.extname(filePath).toLowerCase() === ".toml" ? "toml" : "json";
}

/** Key of the servers table, per encoding: Claude's JSON vs Codex's TOML. */
export function mcpServersKey(format: McpFormat): "mcpServers" | "mcp_servers" {
  return format === "toml" ? "mcp_servers" : "mcpServers";
}

/**
 * Merge the editor's fields into the entry already in the file.
 *
 * The transport is only ever written under the key the entry already used
 * (`type` for Claude, `transport` where a file chose that spelling), and stdio
 * — the documented default — adds no key to an entry that did not have one.
 * Empty collections are removed rather than written as `[]` / `{}`.
 */
export function applyMcpFields(
  existing: Record<string, unknown> | undefined,
  fields: McpFields,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(existing ?? {}) };

  const transportKey = "transport" in out && !("type" in out) ? "transport" : "type";
  if (fields.transport === "stdio") {
    if (transportKey in out) out[transportKey] = "stdio";
  } else {
    out[transportKey] = fields.transport;
  }

  setOrDelete(out, "command", fields.command?.trim() || null);
  setOrDelete(out, "url", fields.url?.trim() || null);

  const args = fields.args.filter((a) => a !== "");
  setOrDelete(out, "args", args.length ? args : null);
  setOrDelete(out, "env", nonEmptyMap(fields.env));
  setOrDelete(out, "headers", nonEmptyMap(fields.headers));

  return out;
}

function setOrDelete(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value == null) delete target[key];
  else target[key] = value;
}

function nonEmptyMap(map: Record<string, string>): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k.trim() === "") continue;
    out[k.trim()] = v;
  }
  return Object.keys(out).length ? out : null;
}

export type WriteMcpInput = {
  /** Absolute path of `.mcp.json`, `~/.claude.json` or a `config.toml`. */
  sourceFile: string;
  /** Server key to write. */
  name: string;
  /** The key currently in the file, when the save also renames the server. */
  previousName?: string;
  /** Fields to merge in; omitted when `remove` is set. */
  fields?: McpFields;
  /** Delete the entry instead of writing it. */
  remove?: boolean;
  expectedMtimeMs?: number | null;
};

export type WriteMcpResult = SafeWriteResult & {
  format: McpFormat;
  /**
   * `true` when the file was TOML *and* carried comments. `smol-toml` has no
   * comment-preserving serialiser, so a save drops them — the UI warns before
   * the fact, and the `.bak` is what gets them back.
   */
  commentsLost: boolean;
};

/**
 * Write one MCP server entry into a config file, leaving every other entry and
 * every unrelated setting exactly where it was.
 */
export async function writeMcp(input: WriteMcpInput): Promise<WriteMcpResult> {
  const format = mcpFormatFor(input.sourceFile);
  const source = await readTextOrNull(input.sourceFile);
  const doc = parseConfigDocument(source, format, input.sourceFile);

  const key = mcpServersKey(format);
  const existingTable = doc[key];
  const servers: Record<string, unknown> =
    isPlainObject(existingTable) ? { ...existingTable } : {};

  const previous = input.previousName ?? input.name;
  const current = isPlainObject(servers[previous])
    ? (servers[previous] as Record<string, unknown>)
    : undefined;

  if (previous !== input.name) delete servers[previous];

  if (input.remove) {
    delete servers[input.name];
  } else {
    if (!input.fields) throw new Error("writeMcp needs fields unless it is removing an entry");
    servers[input.name] = applyMcpFields(current, input.fields);
  }

  doc[key] = servers;
  const text = format === "toml" ? renderToml(doc) : `${JSON.stringify(doc, null, 2)}\n`;

  const result = await safeWriteFile(input.sourceFile, text, {
    expectedMtimeMs: input.expectedMtimeMs,
  });
  return {
    ...result,
    format,
    commentsLost: format === "toml" && source != null && hasTomlComments(source),
  };
}

function parseConfigDocument(
  source: string | null,
  format: McpFormat,
  filePath: string,
): Record<string, unknown> {
  if (source == null || source.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = format === "toml" ? parseToml(source) : JSON.parse(source);
  } catch (err) {
    throw new Error(
      `${filePath} is not valid ${format.toUpperCase()} — fix it by hand before editing it here ` +
        `(${err instanceof Error ? err.message.split("\n")[0] : String(err)}).`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${filePath} does not hold an object at its top level.`);
  }
  return { ...parsed };
}

function renderToml(doc: Record<string, unknown>): string {
  const text = stringifyToml(doc);
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * `true` when the TOML source carries at least one comment.
 *
 * A `#` only starts a comment outside a string, so this walks the document
 * tracking basic (`"`), literal (`'`) and multi-line (`"""` / `'''`) strings.
 * It is a detector, not a parser: a false positive costs one extra warning.
 */
export function hasTomlComments(source: string): boolean {
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === "#") return true;
    if (c === '"' || c === "'") {
      const triple = source.startsWith(c.repeat(3), i);
      const delimiter = triple ? c.repeat(3) : c;
      const escapes = c === '"'; // literal strings have no escape sequences
      i += delimiter.length;
      while (i < source.length) {
        if (escapes && source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source.startsWith(delimiter, i)) {
          i += delimiter.length;
          break;
        }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return false;
}

// ------------------------------------------------------------------- helpers

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}
