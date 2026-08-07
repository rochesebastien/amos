import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanProject } from "../../src/main/scanner/index.js";
import { parseMarkdown } from "../../src/main/scanner/schemas.js";
import {
  applyFrontmatterFields,
  applyMcpFields,
  hasTomlComments,
  serializeMarkdown,
  writeAgent,
  writeMcp,
  writeSkillMd,
} from "../../src/main/scanner/writers.js";
import { WriteConflictError, statMtimeMs } from "../../src/main/services/safeWrite.js";
import type { McpFields } from "../../src/shared/ipc.js";

/**
 * Round-trip tests: parse a real fixture, change exactly one field, write it
 * back, parse it again. What matters is what did *not* change — unknown
 * frontmatter keys, sibling MCP servers, unrelated TOML tables — because those
 * belong to whoever owns the file, not to AMOS.
 *
 * Every test works on a copy in a temp folder; the fixtures stay pristine.
 */

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

let work: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), "amos-writers-"));
});

afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

/** Copy one fixture tree into the scratch folder and return its root. */
async function copyFixture(name: string): Promise<string> {
  const dest = path.join(work, name);
  await fs.cp(path.join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

async function read(filePath: string): Promise<string> {
  return await fs.readFile(filePath, "utf8");
}

const STDIO: McpFields = {
  transport: "stdio",
  command: "npx",
  args: [],
  env: {},
  url: null,
  headers: {},
};

// ------------------------------------------------------------------- markdown

describe("serializeMarkdown", () => {
  it("round-trips frontmatter and body through the parser", () => {
    const source = serializeMarkdown({ name: "a", tools: ["Read", "Bash"] }, "Body text.");
    const parsed = parseMarkdown(source);
    expect(parsed.frontmatter).toEqual({ name: "a", tools: ["Read", "Bash"] });
    expect(parsed.body).toBe("Body text.\n");
  });

  it("writes a plain markdown file when there is no frontmatter left", () => {
    expect(serializeMarkdown({}, "Just prose.")).toBe("Just prose.\n");
  });
});

describe("applyFrontmatterFields", () => {
  it("leaves keys the form never mentions alone", () => {
    const out = applyFrontmatterFields({ name: "a", color: "blue" }, { description: "d" });
    expect(out).toEqual({ name: "a", color: "blue", description: "d" });
  });

  it("removes a field that was blanked out", () => {
    expect(applyFrontmatterFields({ name: "a", model: "sonnet" }, { model: "" })).toEqual({
      name: "a",
    });
  });

  it("keeps the comma-separated shape a file already used for tools", () => {
    const out = applyFrontmatterFields({ tools: "Read, Grep" }, { tools: ["Read", "Bash"] });
    expect(out.tools).toBe("Read, Bash");
  });

  it("writes a YAML list when the file had one", () => {
    const out = applyFrontmatterFields({ tools: ["Read"] }, { tools: ["Read", "Bash"] });
    expect(out.tools).toEqual(["Read", "Bash"]);
  });
});

describe("writeAgent", () => {
  it("changes one field and leaves every unknown key intact", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".claude", "agents", "reviewer.md");
    const before = parseMarkdown(await read(file));

    await writeAgent({
      filePath: file,
      fields: { model: "opus" },
      body: before.body,
      expectedMtimeMs: await statMtimeMs(file),
    });

    const after = parseMarkdown(await read(file));
    expect(after.frontmatter).toEqual({ ...before.frontmatter, model: "opus" });
    // `color: blue` is a key AMOS has no form for — it must still be there.
    expect(after.frontmatter?.color).toBe("blue");
    expect(after.body).toBe(before.body);
  });

  it("leaves a .bak of the previous content next to the file", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".claude", "agents", "reviewer.md");
    const original = await read(file);

    const result = await writeAgent({ filePath: file, fields: { model: "opus" }, body: "New." });

    expect(result.backupPath).toBe(`${file}.bak`);
    expect(await read(`${file}.bak`)).toBe(original);
  });

  it("rewrites only the body when no field is given", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".claude", "agents", "reviewer.md");
    const before = parseMarkdown(await read(file));

    await writeAgent({ filePath: file, fields: {}, body: "Completely new instructions." });

    const after = parseMarkdown(await read(file));
    expect(after.frontmatter).toEqual(before.frontmatter);
    expect(after.body).toBe("Completely new instructions.\n");
  });

  it("scaffolds a brand-new agent and refuses to clobber an existing one", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".claude", "agents", "fresh.md");

    await writeAgent({
      filePath: file,
      fields: { name: "fresh", description: "A new agent." },
      body: "Do the thing.",
      expectedMtimeMs: null,
    });

    const scan = await scanProject(root, { includeGlobal: false });
    const created = scan.items.find((i) => i.name === "fresh");
    expect(created?.kind).toBe("agent");
    expect(created?.data && "description" in created.data ? created.data.description : null).toBe(
      "A new agent.",
    );

    await expect(
      writeAgent({ filePath: file, fields: {}, body: "again", expectedMtimeMs: null }),
    ).rejects.toBeInstanceOf(WriteConflictError);
  });

  it("refuses to save over a file another tool changed meanwhile", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".claude", "agents", "reviewer.md");
    const stale = (await statMtimeMs(file))! - 10_000;

    await expect(
      writeAgent({ filePath: file, fields: { model: "opus" }, body: "x", expectedMtimeMs: stale }),
    ).rejects.toBeInstanceOf(WriteConflictError);
    expect(await read(file)).toContain("model: sonnet");
  });
});

describe("writeSkillMd", () => {
  it("keeps the skill's unknown frontmatter while editing its description", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".claude", "skills", "pdf-export", "SKILL.md");
    const before = parseMarkdown(await read(file));

    await writeSkillMd({
      filePath: file,
      fields: { description: "Export a report to PDF, quickly." },
      body: before.body,
      expectedMtimeMs: await statMtimeMs(file),
    });

    const after = parseMarkdown(await read(file));
    expect(after.frontmatter).toEqual({
      ...before.frontmatter,
      description: "Export a report to PDF, quickly.",
    });
    expect(after.frontmatter?.license).toBe("MIT");
  });

  it("creates the folder and the SKILL.md of a brand-new skill in one write", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".claude", "skills", "invoice-parser", "SKILL.md");

    await writeSkillMd({
      filePath: file,
      fields: { name: "invoice-parser", description: "Parse invoices." },
      body: "Steps go here.",
      expectedMtimeMs: null,
    });

    const scan = await scanProject(root, { includeGlobal: false });
    const skill = scan.items.find((i) => i.kind === "skill" && i.name === "invoice-parser");
    expect(skill).toBeTruthy();
    expect(skill?.parseError).toBeUndefined();
  });
});

// ------------------------------------------------------------------ mcp entry

describe("applyMcpFields", () => {
  it("adds no transport key to a stdio entry that never had one", () => {
    expect(applyMcpFields({ command: "npx" }, { ...STDIO, command: "uvx" })).toEqual({
      command: "uvx",
    });
  });

  it("updates the transport under the key the entry already used", () => {
    expect(applyMcpFields({ transport: "sse", url: "u" }, { ...STDIO, transport: "http" })).toEqual({
      transport: "http",
      command: "npx",
    });
  });

  it("drops emptied collections instead of writing [] and {}", () => {
    const out = applyMcpFields({ command: "npx", args: ["-y"], env: { A: "1" } }, STDIO);
    expect(out).toEqual({ command: "npx" });
  });

  it("keeps keys AMOS has no form for", () => {
    const out = applyMcpFields({ url: "u", bearer_token_env_var: "TOKEN" }, {
      ...STDIO,
      transport: "http",
      command: null,
      url: "https://new.example.com",
    });
    expect(out).toEqual({
      type: "http",
      url: "https://new.example.com",
      bearer_token_env_var: "TOKEN",
    });
  });
});

describe("writeMcp · JSON", () => {
  it("changes one server and leaves the others and the top level alone", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".mcp.json");
    const before = JSON.parse(await read(file));

    const result = await writeMcp({
      sourceFile: file,
      name: "filesystem",
      fields: { ...STDIO, command: "uvx", args: ["--root", "."], env: { ROOT: "/srv" } },
      expectedMtimeMs: await statMtimeMs(file),
    });

    expect(result.format).toBe("json");
    expect(result.commentsLost).toBe(false);

    const after = JSON.parse(await read(file));
    expect(after.mcpServers.filesystem).toEqual({
      command: "uvx",
      args: ["--root", "."],
      env: { ROOT: "/srv" },
    });
    expect(after.mcpServers.docs).toEqual(before.mcpServers.docs);
    expect(after.mcpServers.events).toEqual(before.mcpServers.events);
    expect(after.someUnknownTopLevelKey).toEqual({ kept: true });
    // The `.bak` is a byte copy of what was there — the *original* formatting,
    // not a re-serialisation of it.
    expect(JSON.parse(await read(`${file}.bak`))).toEqual(before);
    expect(await read(`${file}.bak`)).toContain('"events": { "type": "sse"');
  });

  it("adds a server to a file that has none", async () => {
    const file = path.join(work, ".mcp.json");
    await writeMcp({
      sourceFile: file,
      name: "docs",
      fields: { ...STDIO, command: null, transport: "http", url: "https://d.example.com" },
      expectedMtimeMs: null,
    });
    expect(JSON.parse(await read(file))).toEqual({
      mcpServers: { docs: { type: "http", url: "https://d.example.com" } },
    });
  });

  it("renames a server without disturbing its neighbours", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".mcp.json");

    await writeMcp({
      sourceFile: file,
      name: "files",
      previousName: "filesystem",
      fields: { ...STDIO, args: ["-y"], env: { ROOT: "/srv" } },
    });

    const after = JSON.parse(await read(file));
    expect(after.mcpServers.filesystem).toBeUndefined();
    expect(after.mcpServers.files).toEqual({ command: "npx", args: ["-y"], env: { ROOT: "/srv" } });
    expect(Object.keys(after.mcpServers).sort()).toEqual(["docs", "events", "files", "socket"]);
  });

  it("removes a server and leaves the rest of the document standing", async () => {
    const root = await copyFixture("claude-only");
    const file = path.join(root, ".mcp.json");

    await writeMcp({ sourceFile: file, name: "events", remove: true });

    const after = JSON.parse(await read(file));
    expect(after.mcpServers.events).toBeUndefined();
    expect(Object.keys(after.mcpServers).sort()).toEqual(["docs", "filesystem", "socket"]);
    expect(after.someUnknownTopLevelKey).toEqual({ kept: true });
  });

  it("refuses to touch a file it cannot parse", async () => {
    const file = path.join(work, "broken.json");
    await fs.writeFile(file, "{ not json");
    await expect(
      writeMcp({ sourceFile: file, name: "x", fields: STDIO }),
    ).rejects.toThrow(/not valid JSON/);
    expect(await read(file)).toBe("{ not json");
  });
});

describe("writeMcp · TOML", () => {
  it("changes one table and leaves the other tables and settings intact", async () => {
    const root = await copyFixture("codex-only");
    const file = path.join(root, ".codex", "config.toml");
    const before = parseToml(await read(file)) as Record<string, any>;

    const result = await writeMcp({
      sourceFile: file,
      name: "filesystem",
      fields: { ...STDIO, command: "uvx", args: ["-y"], env: { ROOT: "/srv" } },
      expectedMtimeMs: await statMtimeMs(file),
    });

    expect(result.format).toBe("toml");

    const after = parseToml(await read(file)) as Record<string, any>;
    expect(after.model).toBe("gpt-5-codex");
    expect(after.approval_policy).toBe("on-request");
    expect(after.mcp_servers.filesystem).toEqual({
      command: "uvx",
      args: ["-y"],
      env: { ROOT: "/srv" },
    });
    expect(after.mcp_servers.remote).toEqual(before.mcp_servers.remote);
  });

  it("reports that comments were lost, and the .bak still has them", async () => {
    const file = path.join(work, "config.toml");
    const original = [
      "# the model we settled on",
      'model = "gpt-5-codex"',
      "",
      "[mcp_servers.docs]",
      'command = "npx" # inline note',
      "",
    ].join("\n");
    await fs.writeFile(file, original);

    const result = await writeMcp({
      sourceFile: file,
      name: "docs",
      fields: { ...STDIO, command: "uvx" },
    });

    expect(result.commentsLost).toBe(true);
    expect(await read(file)).not.toContain("#");
    expect(await read(`${file}.bak`)).toBe(original);
  });

  it("reports no comment loss for a TOML file that had none", async () => {
    const root = await copyFixture("codex-only");
    const file = path.join(root, ".codex", "config.toml");
    const result = await writeMcp({ sourceFile: file, name: "filesystem", fields: STDIO });
    expect(result.commentsLost).toBe(false);
  });

  it("creates a config.toml, and the scanner reads back what was written", async () => {
    const root = path.join(work, "fresh-project");
    const file = path.join(root, ".codex", "config.toml");

    await writeMcp({
      sourceFile: file,
      name: "docs",
      fields: { ...STDIO, command: "npx", args: ["-y", "docs"] },
      expectedMtimeMs: null,
    });

    const scan = await scanProject(root, { includeGlobal: false });
    const item = scan.items.find((i) => i.name === "docs");
    expect(item?.kind).toBe("mcp");
    expect(item?.data && "command" in item.data ? item.data.command : null).toBe("npx");
    expect(item?.data && "args" in item.data ? item.data.args : null).toEqual(["-y", "docs"]);
  });
});

describe("hasTomlComments", () => {
  it("finds comments on their own line and after a value", () => {
    expect(hasTomlComments("# hello\na = 1\n")).toBe(true);
    expect(hasTomlComments('a = 1 # why\n')).toBe(true);
  });

  it("does not mistake a # inside a string for a comment", () => {
    expect(hasTomlComments('url = "https://x/#anchor"\n')).toBe(false);
    expect(hasTomlComments("literal = 'a # b'\n")).toBe(false);
    expect(hasTomlComments('multi = """\na # b\n"""\n')).toBe(false);
    expect(hasTomlComments('escaped = "a \\" # b"\n')).toBe(false);
  });
});

// ---------------------------------------------------------- scanner agreement

describe("scan → edit → scan", () => {
  it("shows the edited value on the next scan and nothing else moves", async () => {
    const root = await copyFixture("mixed");
    const before = await scanProject(root, { includeGlobal: false });
    const agent = before.items.find((i) => i.kind === "agent");
    if (!agent || agent.kind !== "agent" || !agent.data) throw new Error("no agent in fixture");

    await writeAgent({
      filePath: agent.sourceFile,
      fields: { description: "Edited by AMOS." },
      body: agent.data.body,
      expectedMtimeMs: agent.mtimeMs,
    });

    const after = await scanProject(root, { includeGlobal: false });
    const edited = after.items.find((i) => i.id === agent.id);
    expect(edited?.kind === "agent" ? edited.data?.description : null).toBe("Edited by AMOS.");
    expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
    expect(edited?.mtimeMs).toBeGreaterThan(0);
  });

  it("hands the scan a fresh mtime the editor can save against", async () => {
    const root = await copyFixture("claude-only");
    const scan = await scanProject(root, { includeGlobal: false });
    const agent = scan.items.find((i) => i.kind === "agent")!;
    expect(agent.mtimeMs).toBe(await statMtimeMs(agent.sourceFile));
  });
});

describe("scan targets", () => {
  it("names where each ecosystem's new capabilities go", async () => {
    const root = await copyFixture("claude-only");
    const scan = await scanProject(root, { home: path.join(work, "home") });

    const claude = scan.targets.find((t) => t.ecosystem === "claude" && t.scope === "project")!;
    expect(claude.agentsDir).toBe(path.join(root, ".claude", "agents"));
    expect(claude.mcpFile).toBe(path.join(root, ".mcp.json"));
    expect(claude.mcpFormat).toBe("json");

    const codex = scan.targets.find((t) => t.ecosystem === "codex" && t.scope === "project")!;
    // Codex has no agent folder: its agent instructions are AGENTS.md files.
    expect(codex.agentsDir).toBeNull();
    expect(codex.mcpFormat).toBe("toml");

    expect(scan.targets.filter((t) => t.scope === "global")).toHaveLength(2);
  });

  it("omits the global targets when the global scan is off", async () => {
    const root = await copyFixture("claude-only");
    const scan = await scanProject(root, { includeGlobal: false });
    expect(scan.targets.every((t) => t.scope === "project")).toBe(true);
  });
});
